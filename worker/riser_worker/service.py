"""HTTP surface for the worker.

The worker never authenticates an end user. The store backend does that - it
already owns identity - and calls here with a shared service token. Keeping the
trust boundary in one place means this service has no session handling, no
cookies and no user table to get wrong.

FastAPI is imported at module scope, so the rest of the package stays usable
(and testable) without it installed. Nothing in riser_worker/__init__.py
imports this module.

Every failure comes back in one shape::

    {"error": {"code": "bad-layer", "message": "..."}}

``code`` is stable and machine-readable; ``message`` is for a human reading a
log. A caller that switches on the code will keep working when the prose gets
better, which is not true of matching on the message.
"""

from __future__ import annotations

import os
from typing import Annotated, Any

from fastapi import Depends, FastAPI, Header, HTTPException, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from starlette.exceptions import HTTPException as StarletteHTTPException

from . import __version__
from .api import RiserLayer
from .document import RiserLayerError
from .validate import Severity

SERVICE_TOKEN_ENV = "RISER_WORKER_TOKEN"

app = FastAPI(
    title="Riser USD worker",
    version=__version__,
    description=(
        "Opens Riser USD layers with OpenUSD, recomputes guide positions from "
        "their surface bindings, and reports on what it finds."
    ),
)


def require_service_token(
    authorization: Annotated[str | None, Header()] = None,
) -> None:
    """Reject anything that is not the store backend.

    An unset token is treated as a misconfiguration and refuses every request,
    rather than defaulting to open. A worker that silently accepts anonymous
    jobs is worse than one that is visibly down.
    """
    expected = os.environ.get(SERVICE_TOKEN_ENV)
    if not expected:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            f"{SERVICE_TOKEN_ENV} is not set; the worker cannot verify callers.",
        )
    if authorization != f"Bearer {expected}":
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid service token.")


# -------------------------------------------------------------------------
# Errors
# -------------------------------------------------------------------------

#: HTTP status to stable error code. Anything unmapped is "error", so adding a
#: status never produces an unlabelled failure.
_ERROR_CODES = {
    status.HTTP_400_BAD_REQUEST: "bad-layer",
    status.HTTP_401_UNAUTHORIZED: "unauthorized",
    status.HTTP_404_NOT_FOUND: "not-found",
    # Spelled as a literal: Starlette renamed its 422 constant, and naming
    # either one pins us to a version range we do not otherwise need.
    422: "invalid-request",
    status.HTTP_503_SERVICE_UNAVAILABLE: "not-configured",
}


def _error(status_code: int, message: str, **extra: Any) -> JSONResponse:
    body: dict[str, Any] = {
        "code": _ERROR_CODES.get(status_code, "error"),
        "message": message,
    }
    body.update(extra)
    return JSONResponse(status_code=status_code, content={"error": body})


# Registered against Starlette's class rather than FastAPI's subclass, so that
# a 404 from the router - which Starlette raises itself - comes back in the
# same shape as a 400 we raised. Half a consistent error format is no format.
@app.exception_handler(StarletteHTTPException)
def _http_exception_handler(
    request: Request, exc: StarletteHTTPException
) -> JSONResponse:
    return _error(exc.status_code, str(exc.detail))


@app.exception_handler(RequestValidationError)
def _request_validation_handler(
    request: Request, exc: RequestValidationError
) -> JSONResponse:
    # Pydantic's own error list is genuinely useful to whoever is writing the
    # client, so it rides along under `details` rather than being flattened.
    return _error(422, "The request body is not valid.", details=exc.errors())


@app.exception_handler(RiserLayerError)
def _layer_error_handler(request: Request, exc: RiserLayerError) -> JSONResponse:
    return _error(status.HTTP_400_BAD_REQUEST, str(exc))


# -------------------------------------------------------------------------
# Request and response models
# -------------------------------------------------------------------------


class LayerRequest(BaseModel):
    """A layer to work on. Shared by every job endpoint."""

    usda: str = Field(description="The Riser USD layer, as text.")
    asset_path: str | None = Field(
        default=None,
        description=(
            "Filesystem directory the layer's character reference should "
            "resolve against. When omitted, the reference is resolved relative "
            "to the temporary file the layer is written to, which only works "
            "for absolute references."
        ),
    )


class ValidateRequest(LayerRequest):
    """A layer to check, plus what the template says must be present."""

    required_guide_ids: list[str] = Field(default_factory=list)


class ResolveRequest(LayerRequest):
    """A layer to resolve. No checking, just positions."""

    include_curves: bool = Field(
        default=True,
        description="Set false to skip curve resolution on a guides-only pipeline.",
    )


class BindingOut(BaseModel):
    prim_path: str
    face_index: int
    barycentric: tuple[float, float, float]
    offset: tuple[float, float, float]


class IssueOut(BaseModel):
    severity: Severity
    code: str
    message: str
    subject: str


class ResolvedGuideOut(BaseModel):
    id: str
    group: str
    position: tuple[float, float, float]
    authored_position: tuple[float, float, float]
    drift: float
    bound: bool
    # Added after the first release. Defaulted so an older client that models
    # this response with a strict schema does not break on the new fields.
    resolved: bool = True
    normal: tuple[float, float, float] = (0.0, 1.0, 0.0)
    source: str = "user"
    confidence: float = 1.0
    binding: BindingOut | None = None


class ResolvedCurvePointOut(BaseModel):
    index: int
    position: tuple[float, float, float]
    authored_position: tuple[float, float, float]
    normal: tuple[float, float, float]
    drift: float
    bound: bool
    resolved: bool
    binding: BindingOut | None = None


class ResolvedCurveOut(BaseModel):
    id: str
    group: str
    closed: bool
    width: float
    points: list[ResolvedCurvePointOut]


class LayerSummaryOut(BaseModel):
    doc_version: str
    template_id: str
    name: str
    character_ref: str
    up_axis: str
    meters_per_unit: float


class ValidateResponse(BaseModel):
    ok: bool
    template_id: str
    name: str
    character_ref: str
    up_axis: str
    meters_per_unit: float
    mesh_paths: list[str]
    guides: list[ResolvedGuideOut]
    issues: list[IssueOut]


class ResolveResponse(BaseModel):
    layer: LayerSummaryOut
    mesh_paths: list[str]
    guides: list[ResolvedGuideOut]
    curves: list[ResolvedCurveOut]


# -------------------------------------------------------------------------
# Endpoints
# -------------------------------------------------------------------------


@app.get("/health")
def health() -> dict[str, str]:
    """Liveness only - deliberately unauthenticated so a probe can reach it."""
    return {"status": "ok", "version": __version__}


@app.post(
    "/jobs/validate",
    response_model=ValidateResponse,
    dependencies=[Depends(require_service_token)],
)
def validate_layer(request: ValidateRequest) -> ValidateResponse:
    """Open a layer, recompute every binding, and report."""
    layer = _open(request)
    report = layer.validate(request.required_guide_ids or None)
    doc = layer.document

    return ValidateResponse(
        ok=report.ok,
        template_id=doc.template_id,
        name=doc.name,
        character_ref=doc.character_ref,
        up_axis=doc.up_axis,
        meters_per_unit=doc.meters_per_unit,
        mesh_paths=layer.mesh_paths,
        guides=[_guide_out(g) for g in report.guides],
        issues=[
            IssueOut(
                severity=i.severity, code=i.code, message=i.message, subject=i.subject
            )
            for i in report.issues
        ],
    )


@app.post(
    "/jobs/resolve",
    response_model=ResolveResponse,
    dependencies=[Depends(require_service_token)],
)
def resolve_layer(request: ResolveRequest) -> ResolveResponse:
    """Recompute positions and hand them back, without judging the document.

    Separate from /jobs/validate because the two answer different questions. A
    rig build wants positions and does not care about drift warnings; a save
    wants the report and does not need every curve control vertex. Unlike the
    validate response, this one includes guides whose binding failed to
    resolve, flagged with ``resolved: false``, so a caller sees the whole
    checklist rather than a silently shorter list.
    """
    layer = _open(request)
    doc = layer.document

    return ResolveResponse(
        layer=LayerSummaryOut(
            doc_version=doc.doc_version,
            template_id=doc.template_id,
            name=doc.name,
            character_ref=doc.character_ref,
            up_axis=doc.up_axis,
            meters_per_unit=doc.meters_per_unit,
        ),
        mesh_paths=layer.mesh_paths,
        guides=[_guide_out(g) for g in layer.guides()],
        curves=(
            [_curve_out(c) for c in layer.curves()] if request.include_curves else []
        ),
    )


def _open(request: LayerRequest) -> RiserLayer:
    """Compose the posted layer, mapping a bad one onto a 400."""
    try:
        return RiserLayer.from_text(request.usda, asset_dir=request.asset_path)
    except RiserLayerError as err:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(err)) from err


def _binding_out(binding: Any) -> BindingOut | None:
    if binding is None:
        return None
    return BindingOut(
        prim_path=binding.prim_path,
        face_index=binding.face_index,
        barycentric=binding.barycentric,
        offset=binding.offset,
    )


def _guide_out(guide: Any) -> ResolvedGuideOut:
    return ResolvedGuideOut(
        id=guide.id,
        group=guide.group,
        position=guide.position,
        authored_position=guide.authored_position,
        drift=guide.drift,
        bound=guide.bound,
        resolved=guide.resolved,
        normal=guide.normal,
        source=guide.source,
        confidence=guide.confidence,
        binding=_binding_out(guide.binding),
    )


def _curve_out(curve: Any) -> ResolvedCurveOut:
    return ResolvedCurveOut(
        id=curve.id,
        group=curve.group,
        closed=curve.closed,
        width=curve.width,
        points=[
            ResolvedCurvePointOut(
                index=p.index,
                position=p.position,
                authored_position=p.authored_position,
                normal=p.normal,
                drift=p.drift,
                bound=p.bound,
                resolved=p.resolved,
                binding=_binding_out(p.binding),
            )
            for p in curve.points
        ],
    )
