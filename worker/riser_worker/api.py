"""The public API. Start here.

Everything else in this package is machinery: a USD reader, a triangulator that
matches three.js, a validator. This module is the surface a pipeline is meant
to hold on to, and the one that will not be reshaped underneath it.

The common case is three lines::

    from riser_worker import RiserLayer

    layer = RiserLayer.open("hero.usda")
    for guide in layer.guides():
        print(guide.id, guide.position)

``guide.position`` there is not the number stored in the file. It is recomputed
from the guide's surface binding against the geometry the layer's character
reference actually resolves to, which is the whole reason the format stores a
binding rather than a point. See ``guides()``.

Why a class rather than free functions: opening a layer produces three things
that must stay together - the composed stage, the document read off it, and the
triangulated meshes the bindings index into. Handing those back separately
invites a caller to pair a document with the wrong meshes, and the result of
that is not an exception, it is markers in the wrong place.
"""

from __future__ import annotations

import tempfile
from collections.abc import Iterable
from pathlib import Path
from typing import Any, TypeAlias

from pxr import Usd

from .document import (
    RiserDocument,
    RiserLayerError,
    collect_meshes,
    open_stage,
    read_document,
)
from .mesh import TriangulatedMesh
from .templates import Template, find_template, missing_guide_ids
from .validate import (
    ResolvedCurve,
    ResolvedGuide,
    ValidationReport,
    resolve_curves,
    resolve_guides,
    validate,
)

#: What a required-guide set may be given as. A ``Template``, a template id or
#: path for ``find_template`` to resolve, or a plain set of ids for a caller
#: whose checklist lives somewhere else entirely.
TemplateLike: TypeAlias = "Template | str | Path | Iterable[str]"


class RiserLayer:
    """An opened Riser layer, plus everything derived from it.

    Construct with ``RiserLayer.open`` or ``RiserLayer.from_text``. The
    constructor takes already-composed parts and exists for the rare caller
    that has its own stage.
    """

    def __init__(
        self,
        stage: Usd.Stage,
        document: RiserDocument,
        *,
        source_path: Path | None = None,
        meshes: dict[str, TriangulatedMesh] | None = None,
    ) -> None:
        self._stage = stage
        self._document = document
        self._source_path = source_path
        self._meshes = meshes

    # -- construction ----------------------------------------------------

    @classmethod
    def open(cls, path: str | Path) -> RiserLayer:
        """Open a layer from disk.

        The character reference resolves relative to this file, so the layer
        has to exist where its relative reference expects the asset to be.
        Raises ``RiserLayerError`` if the file is not a Riser layer.
        """
        path = Path(path)
        stage = open_stage(path)
        return cls(stage, read_document(stage), source_path=path)

    @classmethod
    def from_text(
        cls, usda: str, *, asset_dir: str | Path | None = None
    ) -> RiserLayer:
        """Open a layer held in memory, for a service that never wrote it down.

        OpenUSD resolves a reference relative to the layer's own location, so
        the text has to touch a filesystem somewhere for a relative character
        reference to compose at all. ``asset_dir`` is that somewhere: point it
        at the directory the reference is relative to. Without it, only an
        absolute reference will resolve.

        Geometry is collected before the temporary file is removed, so the
        returned layer is complete and self-contained.
        """
        base = Path(asset_dir) if asset_dir else None
        with tempfile.TemporaryDirectory() as tmp:
            directory = base if base and base.is_dir() else Path(tmp)
            layer_path = directory / "riser-layer-in-memory.usda"
            layer_path.write_text(usda, encoding="utf-8")
            try:
                stage = open_stage(layer_path)
                document = read_document(stage)
                # Force the traversal now: after the unlink below, re-reading
                # points from the layer would be reading a file that is gone.
                meshes = collect_meshes(stage)
            finally:
                layer_path.unlink(missing_ok=True)
        return cls(stage, document, meshes=meshes)

    # -- the parts -------------------------------------------------------

    @property
    def document(self) -> RiserDocument:
        """What the layer says, unresolved. A transcript, not an answer."""
        return self._document

    @property
    def stage(self) -> Usd.Stage:
        """The composed stage, for a caller that wants to go past this API.

        Exposed knowingly: refusing it would only make people copy the reader.
        """
        return self._stage

    @property
    def source_path(self) -> Path | None:
        """Where the layer was opened from, or None for an in-memory layer."""
        return self._source_path

    @property
    def meshes(self) -> dict[str, TriangulatedMesh]:
        """Every usable mesh the reference resolved to, keyed by prim path.

        Triangulated the way three.js triangulates, because that is what the
        stored triangle indices mean. Collected on first use, since inspecting
        a layer does not need geometry and traversing a dense character does
        real work. Meshes Riser cannot index compatibly are absent here and
        reported by ``validate``.
        """
        if self._meshes is None:
            self._meshes = collect_meshes(self._stage)
        return self._meshes

    @property
    def mesh_paths(self) -> list[str]:
        return sorted(self.meshes)

    # -- resolved data ---------------------------------------------------

    def guides(self) -> list[ResolvedGuide]:
        """Every guide with its RESOLVED position.

        ``ResolvedGuide.position`` is ``evaluate(binding) + offset`` computed
        here against real geometry, in double precision, against whatever the
        character reference resolves to today. ``authored_position`` is what
        the browser stored and ``drift`` is the distance between them.

        Positions are in the referenced asset's own space: the units scale,
        up-axis flip and framing the browser applies for display do not exist
        on this stage. Prim transforms inside the asset are baked in, so a head
        offset onto a body lands where the user put it.

        Guides whose binding no longer resolves are still returned, with
        ``resolved`` False and ``position`` falling back to the authored value.
        Check that flag before acting on a position.
        """
        return resolve_guides(self._document, self.meshes)

    def guide(self, guide_id: str) -> ResolvedGuide | None:
        return next((g for g in self.guides() if g.id == guide_id), None)

    def curves(self) -> list[ResolvedCurve]:
        """Every curve, with each control vertex resolved the same way.

        The points are the authored control vertices of a cubic B-spline, not
        a tessellation. A consumer that wants points along the curve rather
        than its hull evaluates the basis itself.
        """
        return resolve_curves(self._document, self.meshes)

    def curve(self, curve_id: str) -> ResolvedCurve | None:
        return next((c for c in self.curves() if c.id == curve_id), None)

    # -- checking --------------------------------------------------------

    def validate(
        self,
        template: TemplateLike | None = None,
        *,
        drift_warning: float = 0.01,
        include_optional: bool = False,
    ) -> ValidationReport:
        """Check the document against the geometry it references.

        Pass ``template`` (a ``Template``, a template id or path, or a plain
        set of guide ids) to also require that the checklist is complete.
        Without it, only the bindings and the geometry are checked, which is
        the right thing when a pipeline stage does not care about the checklist.

        ``drift_warning`` is in stage units. See ``validate.validate``.
        """
        required = (
            _required_guide_ids(template, include_optional=include_optional)
            if template is not None
            else None
        )
        return validate(
            self._document,
            self.meshes,
            set(required) if required else None,
            drift_warning=drift_warning,
        )

    def missing_guides(
        self, template: TemplateLike, *, include_optional: bool = False
    ) -> list[str]:
        """Required guide ids the document has not placed, in template order.

        Optional guides are excluded by default, because their absence is a
        choice rather than an omission.
        """
        if isinstance(template, Template):
            return missing_guide_ids(
                (g.id for g in self._document.guides),
                template,
                include_optional=include_optional,
            )
        if isinstance(template, (str, Path)):
            return self.missing_guides(
                find_template(template), include_optional=include_optional
            )
        placed = {g.id for g in self._document.guides}
        return [gid for gid in template if gid not in placed]

    def template(self, directory: str | Path | None = None) -> Template:
        """The template this document was authored against.

        Raises ``TemplateError`` when it cannot be found, rather than guessing.
        A document validated against the wrong checklist is worse than one that
        was not validated.
        """
        return find_template(self._document.template_id, directory)

    # -- serialisation ---------------------------------------------------

    def summary(self) -> dict[str, Any]:
        """A cheap overview: metadata and counts, no geometry.

        Deliberately does not touch ``meshes``, so summarising a layer stays
        fast on a dense character.
        """
        doc = self._document
        sources: dict[str, int] = {}
        for guide in doc.guides:
            sources[guide.source] = sources.get(guide.source, 0) + 1
        return {
            "path": str(self._source_path) if self._source_path else None,
            "doc_version": doc.doc_version,
            "template_id": doc.template_id,
            "name": doc.name,
            "character_ref": doc.character_ref,
            "up_axis": doc.up_axis,
            "meters_per_unit": doc.meters_per_unit,
            "counts": {
                "guides": len(doc.guides),
                "bound_guides": sum(1 for g in doc.guides if g.binding is not None),
                "curves": len(doc.curves),
                "curve_points": sum(len(c.points) for c in doc.curves),
            },
            "guide_sources": dict(sorted(sources.items())),
        }

    def to_dict(self) -> dict[str, Any]:
        """The whole layer as JSON-safe data, resolved.

        This is the shape a pipeline that does not want to link OpenUSD reads.
        It is a contract: keys are added over time, never renamed or removed.
        """
        return {
            "summary": self.summary(),
            "mesh_paths": self.mesh_paths,
            "guides": [g.to_dict() for g in self.guides()],
            "curves": [c.to_dict() for c in self.curves()],
            "document": self._document.to_dict(),
        }


def _required_guide_ids(template: TemplateLike, *, include_optional: bool) -> list[str]:
    """Coerce whatever the caller passed into a list of required guide ids."""
    if isinstance(template, Template):
        return template.guide_ids(include_optional=include_optional)
    if isinstance(template, (str, Path)):
        return _required_guide_ids(
            find_template(template), include_optional=include_optional
        )
    return list(template)


__all__ = [
    "RiserLayer",
    "RiserLayerError",
    "TemplateLike",
]
