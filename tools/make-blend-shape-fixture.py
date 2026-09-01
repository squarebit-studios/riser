from pxr import Usd, UsdGeom, UsdSkel, Vt, Sdf

stage = Usd.Stage.CreateNew('src/io/fixtures/blend-shapes.usdc')

def mesh(path, shapes):
    m = UsdGeom.Mesh.Define(stage, path)
    m.CreatePointsAttr(Vt.Vec3fArray([(0,0,0),(1,0,0),(1,1,0),(0,1,0),
                                      (0,0,1),(1,0,1),(1,1,1),(0,1,1)]))
    m.CreateFaceVertexCountsAttr(Vt.IntArray([4]))
    m.CreateFaceVertexIndicesAttr(Vt.IntArray([0,1,2,3]))
    names, targets = [], []
    for name, offsets, indices in shapes:
        child = m.GetPath().AppendChild(name)
        bs = UsdSkel.BlendShape.Define(stage, child)
        bs.CreateOffsetsAttr(Vt.Vec3fArray(offsets))
        if indices is not None:
            bs.CreatePointIndicesAttr(Vt.IntArray(indices))
        names.append(name); targets.append(child)
    b = UsdSkel.BindingAPI.Apply(m.GetPrim())
    b.CreateBlendShapesAttr(Vt.TokenArray(names))
    b.CreateBlendShapeTargetsRel().SetTargets(targets)

# A shape shared across two meshes, one mesh-only shape, and a dense shape.
mesh('/face', [('jaw_open', [(0,-1,0),(0,-2,0)], [4,7]),
               ('cheek_puff_l', [(1,0,0)], [2])])
mesh('/gums', [('jaw_open', [(0,-1,0)], [1])])
mesh('/dense', [('all', [(1,0,0),(2,0,0),(3,0,0)], None)])

# A target that names a prim nobody authored, which is what mayaUSD produced.
ghost = UsdGeom.Mesh.Define(stage, '/ghosted')
gb = UsdSkel.BindingAPI.Apply(ghost.GetPrim())
gb.CreateBlendShapesAttr(Vt.TokenArray(['ghost']))
gb.CreateBlendShapeTargetsRel().SetTargets([Sdf.Path('/ghosted/ghost')])

# Offsets and indices that disagree.
bad = UsdGeom.Mesh.Define(stage, '/broken')
child = bad.GetPath().AppendChild('bad')
bs = UsdSkel.BlendShape.Define(stage, child)
bs.CreateOffsetsAttr(Vt.Vec3fArray([(0,1,0),(0,2,0)]))
bs.CreatePointIndicesAttr(Vt.IntArray([3]))
bb = UsdSkel.BindingAPI.Apply(bad.GetPrim())
bb.CreateBlendShapesAttr(Vt.TokenArray(['bad']))
bb.CreateBlendShapeTargetsRel().SetTargets([child])

stage.GetRootLayer().Save()
print('wrote fixture')
