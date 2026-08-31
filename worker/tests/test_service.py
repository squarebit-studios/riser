"""The HTTP surface.

Skipped entirely when FastAPI is absent, which is the normal state of a
checkout: the core package must stay importable and testable without it, so
these tests cannot be allowed to make it a hard requirement. Install the extra
to run them:  pip install -e ".[service]"

What matters here is the contract a caller writes against. The success shapes,
the fact that every failure comes back under one "error" key with a stable
code, and that an unset service token refuses work rather than opening the
door.
"""

from __future__ import annotations

from pathlib import Path

import pytest

fastapi = pytest.importorskip("fastapi", reason="the service extra is not installed")
from fastapi.testclient import TestClient  # noqa: E402

from riser_worker.service import SERVICE_TOKEN_ENV, app  # noqa: E402

FIXTURE = Path(__file__).parent / "fixtures" / "sample-layer.usda"
TOKEN = "test-token"


@pytest.fixture()
def client(monkeypatch) -> TestClient:
    monkeypatch.setenv(SERVICE_TOKEN_ENV, TOKEN)
    return TestClient(app)


@pytest.fixture()
def payload() -> dict:
    if not FIXTURE.exists():
        pytest.skip(f"{FIXTURE.name} is missing; run the TypeScript fixture test.")
    return {
        "usda": FIXTURE.read_text(encoding="utf-8"),
        # The layer's character reference is relative, so the service is told
        # where to resolve it from. Without this the stage composes empty.
        "asset_path": str(FIXTURE.parent),
    }


AUTH = {"Authorization": f"Bearer {TOKEN}"}


class TestHealth:
    def test_it_needs_no_token(self, client):
        # A liveness probe cannot hold a secret, so this endpoint must work
        # before the token is configured at all.
        response = client.get("/health")
        assert response.status_code == 200
        assert response.json()["status"] == "ok"


class TestAuth:
    def test_a_missing_token_is_rejected(self, client, payload):
        response = client.post("/jobs/resolve", json=payload)
        assert response.status_code == 401
        assert response.json()["error"]["code"] == "unauthorized"

    def test_an_unset_server_token_refuses_rather_than_opening_up(
        self, monkeypatch, payload
    ):
        # The failure mode this guards against is a worker deployed without its
        # token quietly accepting anonymous jobs.
        monkeypatch.delenv(SERVICE_TOKEN_ENV, raising=False)
        response = TestClient(app).post("/jobs/resolve", json=payload)
        assert response.status_code == 503
        assert response.json()["error"]["code"] == "not-configured"


class TestValidateEndpoint:
    def test_the_existing_response_shape_is_unchanged(self, client, payload):
        # The store backend already reads these keys. They are not allowed to
        # move, whatever else gets added around them.
        response = client.post("/jobs/validate", json=payload, headers=AUTH)
        assert response.status_code == 200
        body = response.json()
        assert set(body) >= {
            "ok",
            "template_id",
            "name",
            "character_ref",
            "up_axis",
            "meters_per_unit",
            "mesh_paths",
            "guides",
            "issues",
        }
        assert body["ok"] is True
        assert body["template_id"] == "biped"
        assert body["mesh_paths"] == [
            "/Riser/Character/Geom/Body",
            "/Riser/Character/Geom/Head",
        ]

    def test_required_guides_still_produce_errors(self, client, payload):
        response = client.post(
            "/jobs/validate",
            json={**payload, "required_guide_ids": ["pelvis", "headTop"]},
            headers=AUTH,
        )
        body = response.json()
        assert body["ok"] is False
        assert {i["subject"] for i in body["issues"] if i["code"] == "guide-missing"} == {
            "headTop"
        }

    def test_guides_now_carry_provenance(self, client, payload):
        body = client.post("/jobs/validate", json=payload, headers=AUTH).json()
        pelvis = next(g for g in body["guides"] if g["id"] == "pelvis")
        assert pelvis["source"] == "user"
        assert pelvis["confidence"] == 1.0
        assert pelvis["binding"]["prim_path"] == "/Riser/Character/Geom/Body"


class TestResolveEndpoint:
    def test_it_returns_resolved_guides_and_curves(self, client, payload):
        response = client.post("/jobs/resolve", json=payload, headers=AUTH)
        assert response.status_code == 200
        body = response.json()
        assert set(body) == {"layer", "mesh_paths", "guides", "curves"}
        assert len(body["guides"]) == 8
        assert len(body["curves"]) == 2

    def test_positions_are_recomputed_not_echoed(self, client, payload):
        # The reason this endpoint exists. Agreement with the authored value to
        # within float32 print precision is the proof it went through geometry.
        body = client.post("/jobs/resolve", json=payload, headers=AUTH).json()
        pelvis = next(g for g in body["guides"] if g["id"] == "pelvis")
        drift = (
            sum(
                (pelvis["position"][i] - pelvis["authored_position"][i]) ** 2
                for i in range(3)
            )
            ** 0.5
        )
        assert drift < 1e-5
        assert pelvis["resolved"] is True

    def test_it_includes_the_unbound_guide_that_validate_would_flag(
        self, client, payload
    ):
        # resolve answers "where is everything", not "is this document good",
        # so nothing is filtered out of it.
        body = client.post("/jobs/resolve", json=payload, headers=AUTH).json()
        root = next(g for g in body["guides"] if g["id"] == "root")
        assert root["bound"] is False

    def test_curves_can_be_skipped(self, client, payload):
        body = client.post(
            "/jobs/resolve",
            json={**payload, "include_curves": False},
            headers=AUTH,
        ).json()
        assert body["curves"] == []
        assert len(body["guides"]) == 8

    def test_curve_points_keep_their_index(self, client, payload):
        body = client.post("/jobs/resolve", json=payload, headers=AUTH).json()
        jawline = next(c for c in body["curves"] if c["id"] == "jawline")
        assert [p["index"] for p in jawline["points"]] == [0, 1, 2, 3, 4]


class TestErrorShape:
    def test_a_layer_that_is_not_riser_is_a_400_with_a_code(self, client):
        response = client.post(
            "/jobs/resolve",
            json={"usda": '#usda 1.0\ndef Xform "World"\n{\n}\n'},
            headers=AUTH,
        )
        assert response.status_code == 400
        error = response.json()["error"]
        assert error["code"] == "bad-layer"
        assert "Not a Riser layer" in error["message"]

    def test_a_malformed_body_is_a_422_in_the_same_shape(self, client):
        response = client.post("/jobs/resolve", json={"not": "a layer"}, headers=AUTH)
        assert response.status_code == 422
        error = response.json()["error"]
        assert error["code"] == "invalid-request"
        # Pydantic's own detail rides along, since it is what tells a client
        # author which field they got wrong.
        assert error["details"]

    def test_even_a_404_from_the_router_uses_the_error_envelope(self, client):
        # The half-consistent case: if this one still returned {"detail": ...}
        # a caller would need two parsers for one API.
        response = client.get("/no-such-endpoint")
        assert response.status_code == 404
        assert response.json()["error"]["code"] == "not-found"
