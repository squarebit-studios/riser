"""Riser USD worker.

The server-side half of Riser. OpenUSD is a Python/C++ library, so anything
that needs to open a real stage - resolving the character reference,
recomputing guide positions from their bindings, converting an upload to USD -
happens here rather than in the store's NestJS backend.

The split is deliberate and narrow: this service does only what needs OpenUSD.
Identity, document storage and email stay in the store backend, which already
has all three.

Note that ``service`` is not imported here. The core is importable, and
testable, without FastAPI installed.
"""

from .document import (
    Curve,
    CurvePoint,
    Guide,
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
    evaluate_barycentric,
    triangulate,
)
from .validate import (
    Issue,
    ResolvedGuide,
    Severity,
    ValidationReport,
    resolve_binding,
    validate,
)

__all__ = [
    "Curve",
    "CurvePoint",
    "Guide",
    "Issue",
    "MeshTriangulationError",
    "ResolvedGuide",
    "RiserDocument",
    "RiserLayerError",
    "Severity",
    "SurfaceBinding",
    "TriangulatedMesh",
    "ValidationReport",
    "collect_meshes",
    "evaluate_barycentric",
    "open_stage",
    "read_document",
    "resolve_binding",
    "triangulate",
    "validate",
]

__version__ = "0.1.0"
