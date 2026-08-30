"""The rigged stock character has to be real USD, not just three-readable.

tools/make-stock-assets.mjs hand-writes UsdSkel: a SkelRoot, a Skeleton with
joint paths and bind/rest transforms, and per-vertex influences on each mesh.
three's loader accepting it proves only that three accepts it. These open the
same file with Pixar's OpenUSD, so an asset that is subtly malformed - a
transposed matrix, a joint path that does not describe a tree - fails here
rather than in whatever DCC a customer opens it in.

They also check the thing the worker actually needs: that a SkelRoot in the
hierarchy does not stop it finding the meshes a binding refers to.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from pxr import UsdGeom, UsdSkel

from riser_worker import collect_meshes, open_stage

ASSET = Path(__file__).resolve().parents[2] / "public" / "assets" / "biped-rigged.usda"

EXPECTED_JOINT_COUNT = 18


@pytest.fixture(scope="module")
def stage():
    if not ASSET.exists():
        pytest.skip(
            f"{ASSET.name} is missing. Generate it with "
            "`node tools/make-stock-assets.mjs`."
        )
    return open_stage(ASSET)


@pytest.fixture(scope="module")
def skeleton(stage):
    prim = stage.GetPrimAtPath("/Character/Skel")
    assert prim and prim.IsValid(), "no Skeleton prim at /Character/Skel"
    return UsdSkel.Skeleton(prim)


class TestItIsValidUsdSkel:
    def test_the_skel_root_is_a_skel_root(self, stage):
        prim = stage.GetPrimAtPath("/Character")
        assert prim.IsA(UsdSkel.Root)

    def test_the_skeleton_declares_its_joints(self, skeleton):
        joints = skeleton.GetJointsAttr().Get()
        assert len(joints) == EXPECTED_JOINT_COUNT
        assert "Root" in joints
        assert "Root/Hips/Spine/Chest/ShoulderL/ElbowL" in joints

    def test_joint_paths_describe_a_real_tree(self, skeleton):
        # Every joint but the root must name a parent that is also a joint.
        # UsdSkel encodes the hierarchy in these strings alone, so a typo here
        # produces a skeleton that loads and is silently disconnected.
        joints = list(skeleton.GetJointsAttr().Get())
        known = set(joints)
        for path in joints:
            if "/" not in path:
                continue
            parent = path.rsplit("/", 1)[0]
            assert parent in known, f"{path} has no parent joint {parent}"

    def test_there_is_exactly_one_root_joint(self, skeleton):
        roots = [j for j in skeleton.GetJointsAttr().Get() if "/" not in j]
        assert roots == ["Root"]

    def test_bind_and_rest_transforms_are_present_and_counted(self, skeleton):
        bind = skeleton.GetBindTransformsAttr().Get()
        rest = skeleton.GetRestTransformsAttr().Get()
        assert len(bind) == EXPECTED_JOINT_COUNT
        assert len(rest) == EXPECTED_JOINT_COUNT

    def test_bind_transforms_put_the_translation_where_usd_expects_it(self, skeleton):
        # USD is row-vector: translation lives in the LAST ROW. Writing it in
        # the last column loads without complaint and puts every bone at the
        # origin, which is the failure this asserts against.
        joints = list(skeleton.GetJointsAttr().Get())
        bind = skeleton.GetBindTransformsAttr().Get()
        head_index = joints.index("Root/Hips/Spine/Chest/Neck/Head")

        translation = bind[head_index].ExtractTranslation()
        assert translation[1] == pytest.approx(1.62, abs=1e-4), (
            f"head joint bind translation is {tuple(translation)}"
        )

    def test_rest_transforms_are_local_to_the_parent(self, skeleton):
        # Spine sits 0.12 above Hips. A rest transform holding the WORLD
        # position instead would read as 1.06 here and fold the rig up.
        joints = list(skeleton.GetJointsAttr().Get())
        rest = skeleton.GetRestTransformsAttr().Get()
        spine = rest[joints.index("Root/Hips/Spine")].ExtractTranslation()
        assert spine[1] == pytest.approx(0.12, abs=1e-4)


class TestSkinning:
    @pytest.fixture()
    def body(self, stage):
        return stage.GetPrimAtPath("/Character/Geom/Body")

    def test_the_mesh_binds_to_the_skeleton(self, body):
        binding = UsdSkel.BindingAPI(body)
        targets = binding.GetSkeletonRel().GetTargets()
        assert [str(t) for t in targets] == ["/Character/Skel"]

    def test_influences_are_present_and_sized(self, body):
        binding = UsdSkel.BindingAPI(body)
        indices = binding.GetJointIndicesPrimvar()
        weights = binding.GetJointWeightsPrimvar()
        assert indices.HasValue()
        assert weights.HasValue()
        assert indices.GetElementSize() == 4
        assert weights.GetElementSize() == 4

    def test_one_influence_set_per_vertex(self, body):
        mesh = UsdGeom.Mesh(body)
        binding = UsdSkel.BindingAPI(body)
        point_count = len(mesh.GetPointsAttr().Get())
        assert len(binding.GetJointIndicesPrimvar().Get()) == point_count * 4
        assert len(binding.GetJointWeightsPrimvar().Get()) == point_count * 4

    def test_weights_are_normalized(self, body):
        weights = list(UsdSkel.BindingAPI(body).GetJointWeightsPrimvar().Get())
        for start in range(0, min(len(weights), 400), 4):
            total = sum(weights[start : start + 4])
            assert total == pytest.approx(1.0, abs=1e-4)

    def test_indices_are_in_range(self, body):
        indices = UsdSkel.BindingAPI(body).GetJointIndicesPrimvar().Get()
        assert all(0 <= int(i) < EXPECTED_JOINT_COUNT for i in indices)


class TestTheWorkerCanStillUseIt:
    def test_a_skel_root_does_not_hide_the_meshes(self, stage):
        # The worker resolves bindings by prim path. If a SkelRoot in the
        # hierarchy broke traversal, every binding on a rigged character - the
        # normal case for a real upload - would fail to resolve.
        meshes = collect_meshes(stage)
        assert set(meshes) == {"/Character/Geom/Body", "/Character/Geom/Head"}

    def test_the_meshes_carry_usable_triangles(self, stage):
        for mesh in collect_meshes(stage).values():
            assert mesh.triangle_count > 100
            a, b, c = mesh.triangle_points(0)
            assert len(a) == 3 and len(b) == 3 and len(c) == 3
