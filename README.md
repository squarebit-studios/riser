# Riser

A focused web app for setting up 3D characters. Pick or upload a character, then
place named guide markers and trace curves on the body and face by clicking
directly on the mesh. What you author is a **USD layer** that our server-side
systems consume.

> Riser is not a 3D application with a character feature. It is a character
> setup tool that happens to be 3D — the viewport exists to serve one job, and
> everything in the UI is in service of finishing the checklist.

---

## Architecture

```
riser.squarebitstudios.com          static, GitHub Pages
  React 18 + TS + Tailwind          UI chrome only, never in the render loop
  three.js 0.184 (raw)              imperative viewport, owns its own rAF
  USDLoader                         reads .usd/.usda/.usdc/.usdz (+ glTF/FBX/OBJ)
  usda-writer                       authors the Riser layer as USDA text
        |
        |  fetch, credentials: 'include'  (cookie on .squarebitstudios.com)
        v
store backend (NestJS + Prisma)     ../squarebit-store/packages/backend
  auth / user / mail                reused as-is
  riser module                      documents, assets, jobs           [planned]
        |
        v
riser USD worker (Python)           worker/
  usd-core 26.5                     compose, validate, recompute, convert
```

### Why USD works in the browser without WASM

three.js 0.184 ships a real USD stack: a binary USDC crate parser, a USDA text
parser, and a 4,600-line composer that handles `references`, `payload` and
`variantSet`, and builds `THREE.SkinnedMesh` with a real `Skeleton` from
UsdSkel. A rigged USD character loads with its bones intact.

There is no USD *writer* (three's `USDZExporter` emits ARKit meshes, not
arbitrary prims), so Riser authors **USDA text** — the format's own
human-readable serialization. On the server, OpenUSD is the authority.

### Why React is kept out of the frame loop

React renders the panels. The viewport is a plain-TypeScript three.js
application that owns its own `requestAnimationFrame` and mutates three objects
and typed arrays directly. Markers are one instanced draw call; curves are
`Line2`. Nothing about dragging a marker touches React. React Three Fiber was
rejected for exactly this reason — it puts reconciliation in the frame path.

---

## The document format

The user authors a USD layer that **references** the character and adds guides
and curves beside it. The source asset is never modified.

```usda
def Xform "Riser" ( kind = "assembly" )
{
    string riser:template = "biped"

    def "Character" ( prepend references = @./character.usdc@ ) {}

    def Scope "Guides"
    {
        def Xform "wristL"
        {
            double3 xformOp:translate = (0.62, 1.1, 0)
            uniform token[] xformOpOrder = ["xformOp:translate"]

            uniform token riser:guide:id          = "wristL"
            uniform token riser:guide:bound       = "surface"
            rel           riser:guide:bindPrim    = </Riser/Character/Geom/Body>
            int           riser:guide:faceIndex   = 12043
            float3        riser:guide:barycentric = (0.21, 0.34, 0.45)
            float3        riser:guide:offset      = (0, 0, 0)
        }
    }
}
```

### Squarebit Subdivs — placing on a smooth surface

`@squarebit/subdivs-three` — the same Catmull-Clark core the Unreal plugin runs
and the store's Eye and Subdivs pages use — drives the viewport display. It is
here for a reason specific to this app, not for looks: **users place markers on
a smooth surface, but a binding must name a cage triangle.**

Binding to the refined result would force the Python worker to reproduce
Catmull-Clark exactly. Instead:

1. The USD mesh stays the binding target. It is the control cage, and the
   document format does not change at all.
2. The viewport displays the limit surface, refined once into a stencil table
   so re-evaluation is a single sparse matrix product.
3. A click raycasts **both**. The limit surface gives the point the user
   actually means; the cage gives the triangle to bind to. The vector between
   them goes into the binding's existing `offset`.

Because `position = evaluate(binding) + offset` already holds on both sides,
the server recovers the exact clicked point with **no subdivision code at all**
— `worker/tests/test_document.py::TestSubdivisionIsInvisibleHere` is the proof.

The cage and the limit surface are separated by three.js **layers**, not by
`visible`: the raycaster is gated by layers alone, so a cage on a layer the
camera never renders is invisible and still perfectly pickable. At level 0 the
cage sits on both layers, so the offset falls out as zero with no special case.

The toolbar's Subdiv slider is display-only — changing it never moves a marker
that has already been placed, because the binding, not the picture, is what
was recorded.

### Surface bindings — the load-bearing idea

Every guide and every curve control vertex stores **where it is on the
character**, not just where it is in space: a prim path, a triangle index, and
barycentric weights inside that triangle, plus an optional off-surface offset
for guides that belong inside the volume (elbow and hip centres, eyeballs).

    position = evaluate(bindPrim, faceIndex, barycentric) + offset

So a marker survives a retopo, a mesh swap, or a scale change, and the server
recomputes an exact position from real geometry instead of trusting the
browser's float32 arithmetic. This is what makes the data worth running systems
on.

Two consequences worth knowing:

- **Triangle indices must mean the same thing in both languages.** three
  triangulates a USD mesh on load — triangles unchanged, quads as a fan
  `(0,1,2),(0,2,3)`, n-gons by ear clipping. `worker/riser_worker/mesh.py`
  reproduces the first two exactly and *refuses* n-gons rather than guessing at
  a clipper it cannot match.
- **Prim paths are layer paths, not asset paths.** three reports
  `/Character/Geom/Body`; after the layer references the asset onto
  `/Riser/Character`, OpenUSD sees `/Riser/Character/Geom/Body`. The browser
  writes the latter.
- **Positions live in the ASSET's space, not the world's.** Between the two sit
  three transforms that exist only for display: the units scale and up-axis
  flip three's composer applies, and the ground-align/recentre from
  `normalize.ts`. None of them exist on the stage the worker opens, so document
  space is anchored at the loaded asset's own root (`RiserApp.documentRoot`).
  Conversely the worker bakes each mesh prim's accumulated transform into its
  points, so a head offset onto a body resolves where the browser put it.
  Pinned by `src/io/document-space.test.ts` and
  `worker/tests/test_prim_transforms.py`.

---

## Layout

```
src/
  viewport/     Viewport, CameraRig, Picker, Overlays, space,
                SubdivSurface                               — three.js core
  io/           loadCharacter, normalize, CharacterModel      — asset pipeline
  doc/          types, mutations, history, storage,
                usda-writer, usda-reader                      — the document
  tools/        ToolManager, marker/, curve/, mirror          — authoring
  templates/    biped/quadruped/face JSON + registry          — what to place
  app/          RiserApp controller, state, React components
public/assets/  generated blockout characters
tools/          make-stock-assets.mjs
worker/         Python: OpenUSD reader, triangulation, validation, FastAPI
tests/e2e/      Playwright
```

---

## Running it

```bash
npm install
npm run dev            # http://localhost:5173
```

Load a stock character from the toolbar (or drop a `.usd`, `.usda`, `.usdc`,
`.usdz`, `.glb`, `.gltf`, `.fbx` or `.obj` file on the viewport), pick a guide
from the left checklist, and click the character to place it.

| Key | |
|---|---|
| `1` / `2` | marker tool / curve tool |
| `F` / `A` | focus selection / frame all |
| `S` / `X` / `G` | symmetry / x-ray / grid |
| `Ctrl+Z`, `Ctrl+Shift+Z` | undo, redo |
| `Delete` | remove selection |
| `C` | open/close the active curve |
| alt-drag a marker | lift it into or out of the volume |

---

## Testing

```bash
npm run test           # 159 unit tests
npm run test:e2e       # 10 Playwright tests, real WebGL via SwiftShader
cd worker && python -m pytest tests -q    # 48 tests against real OpenUSD
```

Three layers, each proving something the others cannot:

1. **Unit** — barycentric round trips, USDA read/write identity, undo/redo,
   curve math, template invariants. Fast (about a second), run constantly.
2. **Cross-language contract** — `src/doc/fixture.test.ts` writes
   `worker/tests/fixtures/sample-layer.usda` from real picks on the real stock
   asset; `worker/tests/test_document.py` opens that exact file with Pixar's
   OpenUSD and asserts every guide recomputes to within 1e-5 of what the
   browser stored. This is the only test that can prove the browser and the
   server agree — a TypeScript round trip only proves our writer and our reader
   agree with each other, which they could do while both being wrong about USD.
3. **End-to-end** — a real WebGL context, real raycasts, real pointer events
   through the click-versus-drag discriminator. Assertions read the actual
   document, not pixels.

Regenerate the stock characters with `node tools/make-stock-assets.mjs`; CI
fails if the committed assets differ from what the generator produces.

---

## Deployment

`.github/workflows/ci.yml` builds and publishes to GitHub Pages on `main`.
Pages currently serves the repo root directly, so its source must be switched
to **GitHub Actions** for that job to take effect. `CNAME` is copied into the
build so `riser.squarebitstudios.com` survives.

---

## Planned

- **Accounts and persistence.** A `riser` module in the store's NestJS backend
  (`packages/backend/src/modules/`), reusing its existing auth, user and mail.
  Its login cookie already carries a configurable `COOKIE_DOMAIN`, so a store
  session is valid here once Riser's origin joins the CORS allowlist.
  `src/doc/storage.ts` already has the server adapter behind the same interface
  the local one implements.
- **Upload conversion.** glTF/FBX/OBJ to USD through `sbconversion`, which
  already carries `usd-core` and the converters.
- The character systems themselves (auto-rig fitting) plug in behind the
  worker's job interface.

---

Copyright (c) 2026 Squarebit LLC. See [LICENSE](LICENSE).
