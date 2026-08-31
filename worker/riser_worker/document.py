"""Reading a Riser layer with OpenUSD.

This is the authoritative reader. The browser's ``usda-reader.ts`` exists so
the app can reopen its own work; THIS one is what decides what a document
actually says, because it is the one backed by Pixar's implementation of the
format rather than by a parser that only has to understand our own output.

The two must agree, and a cross-language contract test keeps them honest: the
TypeScript writer emits worker/tests/fixtures/sample-layer.usda, and
tests/test_document.py opens that exact file here. If the writer drifts into
something only the browser understands, that test fails.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any

from pxr import Gf, Tf, Usd, UsdGeom

from .mesh import TriangulatedMesh, Vec3, triangulate

ROOT_PATH = "/Riser"
CHARACTER_PATH = "/Riser/Character"
GUIDES_PATH = "/Riser/Guides"
CURVES_PATH = "/Riser/Curves"


class RiserLayerError(ValueError):
    """The layer is not a Riser document, or is malformed."""


class GuideSource(str, Enum):
    """Where a guide's position came from.

    A pipeline needs this to know which positions a person stood behind. An
    auto-rig fit should trust ``USER`` absolutely, take ``SKELETON`` as exact
    wherever the asset shipped a rig, and treat the other two as a starting
    point that still wants checking.

    ``Guide.source`` is a plain ``str`` rather than this enum on purpose: a
    reader that raises on a token it has not seen before is a reader that
    breaks the first time the format grows a fifth source. Compare against
    these members - they are ``str`` values, so ``guide.source is
    GuideSource.USER`` is false but ``guide.source == GuideSource.USER`` is
    true - and treat anything else as unknown rather than as an error.
    """

    USER = "user"
    SKELETON = "skeleton"
    PROPORTIONS = "proportions"
    LANDMARKS = "landmarks"


@dataclass(frozen=True)
class SurfaceBinding:
    """Where a point sits ON the character, rather than where it sits in space.

    ``position = evaluate(bind_prim, face_index, barycentric) + offset``. That
    identity holds in the browser and here, and it is what lets a marker
    survive a retopo, a mesh swap or a scale change.
    """

    #: Prim path of the bound mesh AS THE LAYER COMPOSES IT, so
    #: ``/Riser/Character/Geom/Body`` and not the asset's own ``/Geom/Body``.
    prim_path: str
    #: Triangle index, after the browser's triangulation. See ``mesh.py``.
    face_index: int
    #: Weights inside that triangle; the three components sum to 1.
    barycentric: Vec3
    #: Displacement off the surface, for guides that belong inside the volume.
    offset: Vec3

    def to_dict(self) -> dict[str, Any]:
        return {
            "prim_path": self.prim_path,
            "face_index": self.face_index,
            "barycentric": list(self.barycentric),
            "offset": list(self.offset),
        }


@dataclass(frozen=True)
class Guide:
    """One named marker from the template's checklist, exactly as authored."""

    id: str
    group: str
    #: What the browser computed and stored. A HINT: it was computed in float32
    #: against whatever geometry the browser had loaded at the time. Resolve
    #: the binding instead of trusting it - see ``RiserLayer.guides()``.
    position: Vec3
    normal: Vec3
    binding: SurfaceBinding | None
    #: One of ``GuideSource``, read verbatim so an unknown token survives.
    source: str = GuideSource.USER.value
    #: How far the source trusts the position, 0..1. Always 1 for ``user``.
    confidence: float = 1.0

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "group": self.group,
            "position": list(self.position),
            "normal": list(self.normal),
            "source": self.source,
            "confidence": self.confidence,
            "binding": self.binding.to_dict() if self.binding else None,
        }


@dataclass(frozen=True)
class CurvePoint:
    """One control vertex of a curve, bound the same way a guide is."""

    position: Vec3
    normal: Vec3
    binding: SurfaceBinding | None

    def to_dict(self) -> dict[str, Any]:
        return {
            "position": list(self.position),
            "normal": list(self.normal),
            "binding": self.binding.to_dict() if self.binding else None,
        }


@dataclass(frozen=True)
class Curve:
    """A named curve traced along the character's surface."""

    id: str
    group: str
    closed: bool
    #: Curve width in stage units, from USD ``widths``.
    width: float
    points: list[CurvePoint]

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "group": self.group,
            "closed": self.closed,
            "width": self.width,
            "points": [p.to_dict() for p in self.points],
        }


@dataclass
class RiserDocument:
    """Everything the layer says, before any of it is checked against geometry.

    This is a faithful transcript of the file. Nothing in it is resolved:
    guide positions are the browser's stored values. Use ``RiserLayer`` when
    you want answers rather than a transcript.
    """

    doc_version: str
    template_id: str
    name: str
    character_ref: str
    up_axis: str
    meters_per_unit: float
    guides: list[Guide] = field(default_factory=list)
    curves: list[Curve] = field(default_factory=list)

    def guide(self, guide_id: str) -> Guide | None:
        return next((g for g in self.guides if g.id == guide_id), None)

    def curve(self, curve_id: str) -> Curve | None:
        return next((c for c in self.curves if c.id == curve_id), None)

    def to_dict(self) -> dict[str, Any]:
        return {
            "doc_version": self.doc_version,
            "template_id": self.template_id,
            "name": self.name,
            "character_ref": self.character_ref,
            "up_axis": self.up_axis,
            "meters_per_unit": self.meters_per_unit,
            "guides": [g.to_dict() for g in self.guides],
            "curves": [c.to_dict() for c in self.curves],
        }


def _vec3(value) -> Vec3:
    if value is None:
        return (0.0, 0.0, 0.0)
    return (float(value[0]), float(value[1]), float(value[2]))


def _attr(prim: Usd.Prim, name: str, default=None):
    attr = prim.GetAttribute(name)
    if not attr or not attr.HasAuthoredValue():
        return default
    value = attr.Get()
    return default if value is None else value


def _rel_target(prim: Usd.Prim, name: str) -> str | None:
    rel = prim.GetRelationship(name)
    if not rel:
        return None
    targets = rel.GetTargets()
    return str(targets[0]) if targets else None


def _read_binding(prim: Usd.Prim, namespace: str) -> SurfaceBinding | None:
    bound = _attr(prim, f"{namespace}:bound", "none")
    if str(bound) != "surface":
        return None

    prim_path = _rel_target(prim, f"{namespace}:bindPrim")
    face_index = _attr(prim, f"{namespace}:faceIndex", -1)
    if prim_path is None or int(face_index) < 0:
        return None

    return SurfaceBinding(
        prim_path=prim_path,
        face_index=int(face_index),
        barycentric=_vec3(_attr(prim, f"{namespace}:barycentric")),
        offset=_vec3(_attr(prim, f"{namespace}:offset")),
    )


def open_stage(path: str | Path) -> Usd.Stage:
    """Compose a stage from a layer on disk.

    Every way of failing to open a file arrives here as ``RiserLayerError``.
    OpenUSD is inconsistent about it - a missing file raises
    ``Tf.ErrorException`` while some other refusals just return None - and a
    caller should not have to catch two unrelated exception types, one of which
    is not even a ValueError, to handle "that file did not work".
    """
    try:
        stage = Usd.Stage.Open(str(path))
    except Tf.ErrorException as err:
        detail = " ".join(str(err).split())
        raise RiserLayerError(f"OpenUSD could not open {path}: {detail}") from err
    if stage is None:
        raise RiserLayerError(f"OpenUSD could not open {path}")
    return stage


def read_document(stage: Usd.Stage) -> RiserDocument:
    """Read the Riser data out of an already-composed stage."""
    root = stage.GetPrimAtPath(ROOT_PATH)
    if not root or not root.IsValid():
        raise RiserLayerError(
            f"Not a Riser layer: no {ROOT_PATH} prim. "
            f"Found: {[p.GetPath().pathString for p in stage.GetPseudoRoot().GetChildren()]}"
        )

    doc = RiserDocument(
        doc_version=str(_attr(root, "riser:docVersion", "")),
        template_id=str(_attr(root, "riser:template", "")),
        name=str(_attr(root, "riser:name", "Untitled")),
        character_ref=_read_character_ref(stage),
        up_axis=str(UsdGeom.GetStageUpAxis(stage)),
        meters_per_unit=float(UsdGeom.GetStageMetersPerUnit(stage)),
    )

    guides_scope = stage.GetPrimAtPath(GUIDES_PATH)
    if guides_scope and guides_scope.IsValid():
        for prim in guides_scope.GetChildren():
            guide_id = _attr(prim, "riser:guide:id")
            if not guide_id:
                continue
            doc.guides.append(
                Guide(
                    id=str(guide_id),
                    group=str(_attr(prim, "riser:guide:group", "")),
                    position=_vec3(_attr(prim, "xformOp:translate")),
                    normal=_vec3(_attr(prim, "riser:guide:normal", (0, 1, 0))),
                    binding=_read_binding(prim, "riser:guide"),
                    # Absent on layers written before provenance existed. Back
                    # then the only way to place a guide was by hand, so "user"
                    # is the honest default and not merely a convenient one.
                    source=str(
                        _attr(prim, "riser:guide:source", GuideSource.USER.value)
                    ),
                    confidence=float(_attr(prim, "riser:guide:confidence", 1.0)),
                )
            )

    curves_scope = stage.GetPrimAtPath(CURVES_PATH)
    if curves_scope and curves_scope.IsValid():
        for prim in curves_scope.GetChildren():
            curve_id = _attr(prim, "riser:curve:id")
            if not curve_id:
                continue
            doc.curves.append(_read_curve(prim, str(curve_id)))

    return doc


def _read_character_ref(stage: Usd.Stage) -> str:
    prim = stage.GetPrimAtPath(CHARACTER_PATH)
    if not prim or not prim.IsValid():
        return ""

    # References live in composition metadata, not in a plain attribute.
    stack = prim.GetPrimStack()
    for spec in stack:
        items = spec.referenceList.prependedItems or spec.referenceList.explicitItems
        for ref in items:
            if ref.assetPath:
                return str(ref.assetPath)
    return ""


def _read_curve(prim: Usd.Prim, curve_id: str) -> Curve:
    points = [_vec3(p) for p in (_attr(prim, "points") or [])]
    normals = [_vec3(n) for n in (_attr(prim, "riser:curve:normals") or [])]
    bind_prims = [str(p) for p in (_attr(prim, "riser:curve:bindPrims") or [])]
    face_indices = [int(i) for i in (_attr(prim, "riser:curve:faceIndices") or [])]
    barycentrics = [_vec3(b) for b in (_attr(prim, "riser:curve:barycentrics") or [])]
    offsets = [_vec3(o) for o in (_attr(prim, "riser:curve:offsets") or [])]
    widths = [float(w) for w in (_attr(prim, "widths") or [])]

    curve_points: list[CurvePoint] = []
    for i, position in enumerate(points):
        prim_path = bind_prims[i] if i < len(bind_prims) else ""
        face_index = face_indices[i] if i < len(face_indices) else -1
        binding = (
            SurfaceBinding(
                prim_path=prim_path,
                face_index=face_index,
                barycentric=barycentrics[i] if i < len(barycentrics) else (0.0, 0.0, 0.0),
                offset=offsets[i] if i < len(offsets) else (0.0, 0.0, 0.0),
            )
            if prim_path and face_index >= 0
            else None
        )
        curve_points.append(
            CurvePoint(
                position=position,
                normal=normals[i] if i < len(normals) else (0.0, 1.0, 0.0),
                binding=binding,
            )
        )

    return Curve(
        id=curve_id,
        group=str(_attr(prim, "riser:curve:group", "")),
        closed=bool(_attr(prim, "riser:curve:closed", False)),
        width=widths[0] if widths else 0.0,
        points=curve_points,
    )


def collect_meshes(stage: Usd.Stage) -> dict[str, TriangulatedMesh]:
    """Every mesh on the stage, triangulated in the browser's triangle order.

    Points are baked into STAGE space, not left in the mesh prim's own space.

    That matters whenever anything between the mesh and the stage root carries
    an xformOp - a rig group offsetting a head, an asset placing its parts.
    The browser stores guide positions relative to the referenced asset's root
    (see src/io/document-space.test.ts), so evaluating a binding here without
    the prim transforms would answer in a different coordinate system and every
    guide would appear to have moved.

    /Riser and /Riser/Character carry no transform of their own - the layer
    authors none - so stage space and the asset's own space are the same thing.

    Meshes that cannot be triangulated compatibly are omitted; the validation
    pass reports them by name rather than letting a binding resolve wrongly.
    """
    meshes: dict[str, TriangulatedMesh] = {}
    for prim in stage.Traverse():
        if not prim.IsA(UsdGeom.Mesh):
            continue
        mesh = UsdGeom.Mesh(prim)
        raw_points = mesh.GetPointsAttr().Get() or []
        counts = [int(c) for c in (mesh.GetFaceVertexCountsAttr().Get() or [])]
        indices = [int(i) for i in (mesh.GetFaceVertexIndicesAttr().Get() or [])]
        if len(raw_points) == 0 or not counts:
            continue

        points = _points_in_stage_space(prim, raw_points)

        path = prim.GetPath().pathString
        try:
            meshes[path] = triangulate(path, points, counts, indices)
        except ValueError:
            # Reported by validate.py, which has the context to explain it.
            continue
    return meshes


def _points_in_stage_space(prim: Usd.Prim, raw_points) -> list[Vec3]:
    """Apply the prim's accumulated transform to its points."""
    xform = UsdGeom.Xformable(prim)
    if not xform:
        return [_vec3(p) for p in raw_points]

    matrix = xform.ComputeLocalToWorldTransform(Usd.TimeCode.Default())
    if matrix == Gf.Matrix4d(1.0):
        # Identity is overwhelmingly the common case; skip the arithmetic and
        # keep the exact float values the file declared.
        return [_vec3(p) for p in raw_points]

    out: list[Vec3] = []
    for p in raw_points:
        t = matrix.Transform(Gf.Vec3d(float(p[0]), float(p[1]), float(p[2])))
        out.append((t[0], t[1], t[2]))
    return out
