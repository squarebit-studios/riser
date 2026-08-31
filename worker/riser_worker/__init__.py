"""Riser USD worker.

The server-side half of Riser, and the API a studio integrates against.
OpenUSD is a Python/C++ library, so anything that needs to open a real stage -
resolving the character reference, recomputing guide positions from their
bindings, converting an upload - happens here rather than in the store's NestJS
backend.

The split is deliberate and narrow: this service does only what needs OpenUSD.
Identity, document storage and email stay in the store backend, which already
has all three.

Start with ``RiserLayer``::

    from riser_worker import RiserLayer

    layer = RiserLayer.open("hero.usda")
    report = layer.validate("biped")
    for guide in layer.guides():
        print(guide.id, guide.position)

Positions come back RESOLVED - recomputed from each guide's surface binding
against the geometry the layer references - which is the difference between
this package and reading the file yourself. See ``worker/API.md``.

Note that ``service`` is not imported here. The core is importable, and
testable, without FastAPI installed. ``cli`` is not imported here either, so
importing this package stays cheap for a DCC plug-in that only wants the reader.
"""

from .api import RiserLayer
from .document import (
    Curve,
    CurvePoint,
    Guide,
    GuideSource,
    RiserDocument,
    RiserLayerError,
    SurfaceBinding,
    collect_meshes,
    open_stage,
    read_document,
)
from .mesh import (
    MeshTriangulationError,
    TriangulatedMesh,
    Vec3,
    evaluate_barycentric,
    triangulate,
)
from .templates import (
    CurveDef,
    GuideDef,
    Template,
    TemplateError,
    available_templates,
    find_template,
    load_template,
    load_templates,
    missing_guide_ids,
)
from .validate import (
    Issue,
    ResolvedCurve,
    ResolvedCurvePoint,
    ResolvedGuide,
    Severity,
    ValidationReport,
    resolve_binding,
    resolve_curves,
    resolve_guides,
    validate,
)

__all__ = [
    # The entry point. Everything below it is available for callers that want
    # a piece rather than the whole, but this is the one to reach for first.
    "RiserLayer",
    # Document model, as authored.
    "Curve",
    "CurvePoint",
    "Guide",
    "GuideSource",
    "RiserDocument",
    "SurfaceBinding",
    "Vec3",
    # Resolved data, recomputed from bindings.
    "ResolvedCurve",
    "ResolvedCurvePoint",
    "ResolvedGuide",
    "resolve_binding",
    "resolve_curves",
    "resolve_guides",
    # Validation.
    "Issue",
    "Severity",
    "ValidationReport",
    "validate",
    # Templates: what a document is supposed to contain.
    "CurveDef",
    "GuideDef",
    "Template",
    "TemplateError",
    "available_templates",
    "find_template",
    "load_template",
    "load_templates",
    "missing_guide_ids",
    # Geometry, for callers doing their own evaluation.
    "MeshTriangulationError",
    "TriangulatedMesh",
    "collect_meshes",
    "evaluate_barycentric",
    "triangulate",
    # Lower level stage access.
    "RiserLayerError",
    "open_stage",
    "read_document",
]

__version__ = "0.2.0"
