"""HTTP surface for the worker.

The worker never authenticates an end user. The store backend does that - it
already owns identity - and calls here with a shared service token. Keeping the
trust boundary in one place means this service has no session handling, no
cookies and no user table to get wrong.

FastAPI is imported at module scope, so the rest of the package stays usable
(and testable) without it installed. Nothing in riser_worker/__init__.py
imports this module.
"""

from __future__ import annotations

import os
import tempfile
from pathlib import Path
from typing import Annotated

from fastapi import Depends, FastAPI, Header, HTTPException, status
from pydantic import BaseModel, Field

from .document import RiserLayerError, collect_meshes, open_stage, read_document
from .validate import Severity, validate

SERVICE_TOKEN_ENV = "RISER_WORKER_TOKEN"

app = FastAPI(
    title="Riser USD worker",
    version="0.1.0",
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


class ValidateRequest(BaseModel):
    """A layer to check, plus what the template says must be present."""

    usda: str = Field(description="The Riser USD layer, as text.")
    asset_path: str | None = Field(
        default=None,
        description=(
            "Filesystem path the layer's character reference should resolve "
            "against. When omitted, the reference is resolved relative to the "
            "temporary file the layer is written to, which only works for "
            "absolute references."
        ),
    )
    required_guide_ids: list[str] = Field(default_factory=list)


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


@app.get("/health")
def health() -> dict[str, str]:
    """Liveness only - deliberately unauthenticated so a probe can reach it."""
    return {"status": "ok"}


@app.post(
    "/jobs/validate",
    response_model=ValidateResponse,
    dependencies=[Depends(require_service_token)],
)
def validate_layer(request: ValidateRequest) -> ValidateResponse:
    """Open a layer, recompute every binding, and report."""
    # OpenUSD resolves references relative to the layer on disk, so the layer
    # has to exist as a file for the character reference to compose at all.
    directory = Path(request.asset_path) if request.asset_path else None
    with tempfile.TemporaryDirectory() as tmp:
        base = directory if directory and directory.is_dir() else Path(tmp)
        layer_path = base / "riser-job.usda"
        layer_path.write_text(request.usda, encoding="utf-8")

        try:
            stage = open_stage(layer_path)
            doc = read_document(stage)
        except RiserLayerError as err:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, str(err)) from err
        finally:
            layer_path.unlink(missing_ok=True)

        meshes = collect_meshes(stage)

    report = validate(doc, meshes, set(request.required_guide_ids) or None)

    return ValidateResponse(
        ok=report.ok,
        template_id=doc.template_id,
        name=doc.name,
        character_ref=doc.character_ref,
        up_axis=doc.up_axis,
        meters_per_unit=doc.meters_per_unit,
        mesh_paths=sorted(meshes),
        guides=[
            ResolvedGuideOut(
                id=g.id,
                group=g.group,
                position=g.position,
                authored_position=g.authored_position,
                drift=g.drift,
                bound=g.bound,
            )
            for g in report.guides
        ],
        issues=[
            IssueOut(
                severity=i.severity, code=i.code, message=i.message, subject=i.subject
            )
            for i in report.issues
        ],
    )
