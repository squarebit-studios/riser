# Riser developer API

For studios integrating Riser documents into a pipeline: Maya, Houdini,
Blender, Unreal, or a standalone script.

A Riser document is a USD layer that references a character and adds named
guide markers and curves beside it. What makes it worth building on is that
every guide stores **where it is on the character**, not just where it is in
space:

```
position = evaluate(bindPrim, faceIndex, barycentric) + offset
```

That identity holds in the browser that authored the document and in this
package. A marker therefore survives a retopo, a mesh swap or a scale change,
and this package recomputes an exact position from real geometry rather than
trusting float32 arithmetic done in a web browser.

Three ways in, in order of how much of your pipeline has to know about USD:

| | Use when |
|---|---|
| [Python API](#python-api) | You are inside a DCC or a Python process. Full fidelity. |
| [CLI](#cli) | You are in a shell, a TOP network, or a build step. |
| [HTTP](#http) | You are in another language, or another machine. |

---

## Install

```bash
pip install -e worker                # core: OpenUSD only
pip install -e "worker[service]"     # adds the FastAPI HTTP surface
```

The core requires Python 3.10 or newer and `usd-core`. Nothing else. The CLI is
standard library only, so it installs and runs wherever the core does. FastAPI
is optional and is never imported unless you import `riser_worker.service`,
which means `import riser_worker` stays cheap and dependency-light inside a DCC.

---

## Python API

### The three-line case

```python
from riser_worker import RiserLayer

layer = RiserLayer.open("hero.usda")
for guide in layer.guides():
    print(guide.id, guide.position)
```

`guide.position` is **not** the number stored in the file. It is recomputed
from the guide's surface binding against the geometry the layer's character
reference resolves to right now. `guide.authored_position` is what the browser
stored, and `guide.drift` is the distance between them.

### `RiserLayer`

The entry point. Opening a layer produces three things that must stay together
(the composed stage, the document read off it, and the triangulated meshes the
bindings index into), and `RiserLayer` is what keeps them together. Pairing a
document with the wrong meshes does not raise, it silently puts markers in the
wrong place.

| Member | Returns | |
|---|---|---|
| `RiserLayer.open(path)` | `RiserLayer` | Open a layer from disk. |
| `RiserLayer.from_text(usda, *, asset_dir=None)` | `RiserLayer` | Open a layer held in memory. |
| `.document` | `RiserDocument` | What the layer says, unresolved. |
| `.stage` | `Usd.Stage` | The composed stage, for going past this API. |
| `.source_path` | `Path \| None` | Where it was opened from. |
| `.meshes` | `dict[str, TriangulatedMesh]` | Geometry, keyed by prim path. Lazy. |
| `.mesh_paths` | `list[str]` | Sorted prim paths of usable meshes. |
| `.guides()` | `list[ResolvedGuide]` | Every guide, resolved. |
| `.guide(id)` | `ResolvedGuide \| None` | One guide by id. |
| `.curves()` | `list[ResolvedCurve]` | Every curve, control vertices resolved. |
| `.curve(id)` | `ResolvedCurve \| None` | One curve by id. |
| `.validate(template=None, *, drift_warning=0.01, include_optional=False)` | `ValidationReport` | Check the document. |
| `.missing_guides(template, *, include_optional=False)` | `list[str]` | Required ids not placed, in template order. |
| `.template(directory=None)` | `Template` | The checklist this document was authored against. |
| `.summary()` | `dict` | Metadata and counts. Does not touch geometry. |
| `.to_dict()` | `dict` | The whole layer, resolved, as JSON-safe data. |

Anywhere a `template` is accepted you may pass a `Template`, a template id or
path for the loader to resolve, or a plain iterable of guide ids. A pipeline
whose checklist lives in its own asset database never has to touch the template
machinery at all:

```python
report = layer.validate(["pelvis", "chest", "wristL", "wristR"])
```

### `ResolvedGuide`

```python
guide.id                 # "wristL"
guide.group              # "armL", checklist grouping only
guide.position           # (x, y, z) recomputed from the binding. The answer.
guide.authored_position  # what the browser stored
guide.normal             # surface normal at the pick
guide.drift              # distance between position and authored_position
guide.bound              # True when the guide carries a surface binding
guide.resolved           # False when a binding names geometry that is not there
guide.source             # "user" | "skeleton" | "proportions" | "landmarks"
guide.confidence         # 0..1, always 1.0 for "user"
guide.binding            # SurfaceBinding | None
```

Two flags, and they mean different things:

- `bound is False` means the guide was placed free in space. Legal. `position`
  is the authored value, and there is nothing better to be had.
- `resolved is False` means the guide **is** bound, but the binding names a prim
  or a triangle that is not in the geometry the reference resolved to.
  `position` falls back to the authored value so a naive consumer still gets a
  roughly-right marker, but you should treat it as suspect. This is the
  signature of a document pointed at the wrong asset, or an asset that was
  retopologised without the document being re-authored.

`guides()` returns a row for **every** guide including unresolved ones, because
a pipeline exporting a checklist needs to see the whole roster. Contrast
`ValidationReport.guides`, which contains only the guides validation is willing
to vouch for.

### Provenance

`source` and `confidence` tell you which positions a person stood behind:

| source | meaning |
|---|---|
| `user` | Placed or adjusted by hand. Confidence is always 1.0. |
| `skeleton` | Taken from the asset's own rig. Exact, when there was one. |
| `proportions` | Fitted from the mesh shape and standard proportions. |
| `landmarks` | Predicted by a vision model. |

An auto-rig fit should trust `user` absolutely and treat the bottom two as a
starting point. `GuideSource` is a `str` enum of these four, but `guide.source`
is a plain `str` read verbatim from the file: a reader that raises on a token it
has not seen is a reader that breaks the first time the format grows a fifth
source. Compare with `==`, and treat anything unrecognised as unknown.

### `ResolvedCurve`

```python
curve.id, curve.group, curve.closed, curve.width
curve.points          # list[ResolvedCurvePoint]

point.index           # position in the curve, so order survives JSON
point.position        # resolved
point.authored_position, point.normal, point.drift
point.bound, point.resolved, point.binding
```

The points are the authored **control vertices** of a cubic B-spline, not a
tessellation. If you need points along the curve rather than its hull, evaluate
the basis yourself.

### `ValidationReport`

```python
report = layer.validate("biped")
report.ok            # False if any issue is an error
report.errors        # list[Issue] with severity error
report.warnings      # list[Issue] with severity warning
report.issues        # everything, including info
report.guides        # list[ResolvedGuide], only the ones vouched for
report.to_dict()     # JSON-safe
```

Each `Issue` carries `severity`, a stable `code`, a human `message`, and a
`subject` (a guide or curve id, or `""` for whole-document issues). **Switch on
the code, not the message.** The prose is allowed to improve.

| code | severity | meaning |
|---|---|---|
| `no-geometry` | error | The character reference resolved to no usable meshes. |
| `guide-binding-unresolved` | error | A guide names a prim or triangle that is not there. |
| `curve-binding-unresolved` | error | Same, for a curve control vertex. |
| `guide-missing` | error | A required guide has not been placed. |
| `guide-drift` | warning | A guide recomputes far from its authored position. |
| `guide-out-of-bounds` | warning | A guide resolves well outside the character. |
| `curve-too-short` | warning | Fewer than two control vertices. |
| `curve-unbound-points` | warning | Some control vertices are free in space. |
| `guide-unbound` | info | A guide was placed free in space. |

Drift is not automatically wrong. A document authored against one build of a
mesh and re-run against a denser build **should** move. A large drift is the
signature of a document aimed at the wrong asset. `drift_warning` is in stage
units and defaults to 0.01, a centimetre on a metre-scale character.

### Templates

A template is the checklist the artist was working from. Templates are JSON
files, the same ones the browser bundles, read rather than copied.

```python
from riser_worker import find_template, available_templates

template = find_template("biped")            # by id
template = find_template("/rigs/dragon.json")  # or by path
template.required_guide_ids()                # ordered, optional ones excluded
template.guide("wristL").interior            # True for joint centres

layer.missing_guides(template)               # what is still to do
```

They are looked for in this order:

1. a directory you pass explicitly,
2. `$RISER_TEMPLATES_DIR`,
3. `src/templates` in an enclosing Riser checkout.

Step 3 only works from a source checkout. If you have pip-installed the worker
on its own, set the environment variable or pass a directory. A studio with its
own rig types just points at its own directory, and template invariants (unique
ids, groups that exist, mirrors declared both ways) are checked at load so a
malformed one fails immediately rather than as a checklist entry nobody can
ever satisfy.

### Geometry, if you want to do your own evaluation

```python
from riser_worker import resolve_binding, evaluate_barycentric, triangulate

mesh = layer.meshes["/Riser/Character/Geom/Body"]
mesh.triangle_count
a, b, c = mesh.triangle_points(binding.face_index)
position = resolve_binding(binding, layer.meshes)   # or None
```

Meshes are triangulated the way three.js triangulates, since that is what the
stored triangle indices mean, and their points are baked into stage space. See
[Triangle indices](#triangle-indices-the-one-thing-to-get-right).

### Errors

Everything that means "that file did not work" is `RiserLayerError`, a
`ValueError` subclass: a missing file, something OpenUSD refuses, or a layer
with no `/Riser` prim. Template problems are `TemplateError`, also a
`ValueError`. A mesh that cannot be triangulated compatibly raises
`MeshTriangulationError` from `triangulate`, though `collect_meshes` swallows it
and lets validation report the mesh by name instead.

---

## CLI

```bash
riser <command> <layer> [options]          # installed console script
python -m riser_worker <command> <layer>   # straight out of a checkout
```

Human output goes to stdout, diagnostics to stderr. `--json` puts machine
output on stdout and nothing else, so piping into a JSON parser is safe even
when the command has warnings to make.

### Exit codes

| code | meaning |
|---|---|
| 0 | Success. For `validate`, no errors were reported. |
| 1 | `validate` found at least one error. |
| 2 | Usage error: unknown flag, missing argument, no subcommand. |
| 3 | The file is not a Riser layer, or OpenUSD could not open it. |
| 4 | The layer file does not exist. |
| 5 | The template could not be found, or is invalid. |

3 and 4 are deliberately distinct: "you gave me the wrong path" and "the file
you gave me is not a Riser document" want different responses from whatever is
driving the command.

### `inspect`

```bash
riser inspect hero.usda [--json]
```

Metadata and counts. Does not open the referenced geometry, so it stays fast on
a dense character and still works when the asset is missing, which is exactly
when you want to run it.

```
Hero  (hero.usda)
  document version   1.0.0
  template           biped
  character          ./assets/hero-body.usdc
  stage              up Y, 1.0 m per unit
  guides             49 (46 bound to the surface)
  curves             11 (94 control vertices)
  guide sources      proportions 3, user 46
```

`--json` emits the summary object described under
[JSON shapes](#json-shapes).

### `validate`

```bash
riser validate hero.usda [--template ID_OR_PATH] [--template-dir DIR]
                         [--include-optional] [--drift-warning UNITS] [--json]
```

Recomputes every binding and reports what does not hold up. Exits 1 if anything
is an error, which is what makes it usable as a CI or publish gate:

```bash
riser validate "$LAYER" --template auto || exit 1
```

`--template auto` uses the template id the document itself declares. Without
any `--template`, only bindings and geometry are checked, which is right for a
stage that does not care whether the artist has finished the checklist.

`--json` emits the report object plus `layer` (a summary) and `template_id`.

### `resolve`

```bash
riser resolve hero.usda [--guide ID ...] [--json]
```

The authoritative positions. One line per guide:

```
pelvis                 (   0.256097,    1.485000,   -0.010777)  bound      user         spine
root                   (   0.000000,    0.000000,    0.000000)  free       user         spine
```

then curves, one block each. `--guide` is repeatable and selects specific
guides, and suppresses curves. Asking for a guide the artist has not placed yet
is a warning on stderr and not a failure, because mid-checklist that is a
perfectly normal state and a batch of ids should not fall over on the first gap.

### `export-json`

```bash
riser export-json hero.usda [-o FILE] [--indent N]
```

Everything, for a pipeline that does not want to link OpenUSD: summary, mesh
paths, resolved guides and curves, and the raw authored document so the
resolved values can be audited. `--indent 0` gives one dense line. With `-o`,
stdout stays empty and the confirmation goes to stderr.

### JSON shapes

These are a contract. Keys get added over time; they do not get renamed or
removed.

```jsonc
// riser inspect --json
{
  "path": "hero.usda",
  "doc_version": "1.0.0",
  "template_id": "biped",
  "name": "Hero",
  "character_ref": "./assets/hero-body.usdc",
  "up_axis": "Y",
  "meters_per_unit": 1.0,
  "counts": { "guides": 49, "bound_guides": 46, "curves": 11, "curve_points": 94 },
  "guide_sources": { "proportions": 3, "user": 46 }
}

// riser resolve --json
{
  "layer":  { /* the summary object above */ },
  "guides": [
    {
      "id": "pelvis",
      "group": "spine",
      "position":          [0.2560967, 1.485, -0.0107767],
      "authored_position": [0.2560967, 1.485, -0.0107767],
      "normal":            [0.0, 0.0, 1.0],
      "drift": 0.0,
      "bound": true,
      "resolved": true,
      "source": "user",
      "confidence": 1.0,
      "binding": {
        "prim_path": "/Riser/Character/Geom/Body",
        "face_index": 136,
        "barycentric": [0.3333333, 0.3333333, 0.3333333],
        "offset": [0.0, 0.0, 0.0]
      }
    }
  ],
  "curves": [
    {
      "id": "jawline", "group": "face", "closed": false, "width": 0.004,
      "points": [
        { "index": 0, "position": [...], "authored_position": [...],
          "normal": [...], "drift": 0.0, "bound": true, "resolved": true,
          "binding": { /* as above */ } }
      ]
    }
  ]
}

// riser validate --json
{
  "ok": true,
  "counts": { "errors": 0, "warnings": 0, "guides": 8 },
  "guides": [ /* resolved guides, vouched-for ones only */ ],
  "issues": [
    { "severity": "error", "code": "guide-missing",
      "message": "Required guide 'headTop' has not been placed.",
      "subject": "headTop" }
  ],
  "layer": { /* summary */ },
  "template_id": "biped"
}

// riser export-json
{
  "summary":    { /* summary */ },
  "mesh_paths": ["/Riser/Character/Geom/Body", "/Riser/Character/Geom/Head"],
  "guides":     [ /* resolved, all of them */ ],
  "curves":     [ /* resolved */ ],
  "document":   { /* the authored document, unresolved */ }
}
```

---

## HTTP

```bash
pip install -e "worker[service]"
RISER_WORKER_TOKEN=secret uvicorn riser_worker.service:app --port 8080
```

The worker never authenticates an end user. Callers present a shared service
token. **An unset `RISER_WORKER_TOKEN` refuses every request with 503** rather
than defaulting to open, because a worker that silently accepts anonymous jobs
is worse than one that is visibly down.

```
Authorization: Bearer <RISER_WORKER_TOKEN>
```

### `GET /health`

Unauthenticated, so a probe can reach it. `{"status": "ok", "version": "0.2.0"}`.

### `POST /jobs/resolve`

```jsonc
// request
{
  "usda": "#usda 1.0\n...",          // the layer, as text
  "asset_path": "/assets/hero",       // directory the character ref resolves against
  "include_curves": true              // optional, default true
}

// response 200
{
  "layer": { "doc_version": "...", "template_id": "biped", "name": "...",
             "character_ref": "...", "up_axis": "Y", "meters_per_unit": 1.0 },
  "mesh_paths": ["/Riser/Character/Geom/Body"],
  "guides": [ /* resolved guides, ALL of them, unresolved ones flagged */ ],
  "curves": [ /* resolved curves */ ]
}
```

Positions and no judgement. A rig build wants coordinates and does not care
about drift warnings.

`asset_path` matters: OpenUSD resolves a reference relative to the layer's own
location, so a layer posted as text has to be written somewhere for a relative
character reference to compose at all. Point `asset_path` at the directory the
reference is relative to. Without it, only an absolute reference resolves and
you will get an empty `mesh_paths` and a pile of `guide-binding-unresolved`.

### `POST /jobs/validate`

```jsonc
// request
{ "usda": "...", "asset_path": "...", "required_guide_ids": ["pelvis", "chest"] }

// response 200
{
  "ok": true,
  "template_id": "biped", "name": "...", "character_ref": "...",
  "up_axis": "Y", "meters_per_unit": 1.0,
  "mesh_paths": [...],
  "guides": [ /* resolved guides validation vouches for */ ],
  "issues": [ { "severity": "error", "code": "...", "message": "...", "subject": "..." } ]
}
```

`ok` is false when any issue is an error. The HTTP status is still 200: the
request succeeded, the document did not.

### Errors

Every failure, including a 404 from the router, comes back in one shape:

```json
{ "error": { "code": "bad-layer", "message": "Not a Riser layer: no /Riser prim..." } }
```

| status | code | |
|---|---|---|
| 400 | `bad-layer` | The posted layer is not a Riser document. |
| 401 | `unauthorized` | Missing or wrong service token. |
| 404 | `not-found` | No such endpoint. |
| 422 | `invalid-request` | Malformed body. Carries `details` from pydantic. |
| 503 | `not-configured` | `RISER_WORKER_TOKEN` is not set on the server. |

Switch on `code`. It is stable; `message` is for a human reading a log.

---

## The USD layer format

Everything below is what the code actually reads and writes. It is enough to
write your own reader without this package.

A Riser document is an ordinary USD layer. It **references** the character and
adds guides and curves beside it; the source asset is never modified. Open it
in usdview and you get a scene with the character in it and an Xform per guide.

### Stage metadata

| | |
|---|---|
| `defaultPrim` | `"Riser"` |
| `metersPerUnit` | double, the stage's unit scale |
| `upAxis` | `"Y"` or `"Z"` |
| `doc` | `"Riser document: <name>"`, informational only |

### Prim structure

```
/Riser                     Xform, kind = "assembly"
  /Riser/Character         typeless def, carries the reference to the asset
  /Riser/Guides            Scope
    /Riser/Guides/<name>   Xform, one per guide
  /Riser/Curves            Scope
    /Riser/Curves/<name>   BasisCurves, one per curve
```

Absence of `/Riser` is what makes a layer "not a Riser document". `/Riser` and
`/Riser/Character` carry no transform of their own, so stage space and the
referenced asset's own space are the same thing.

Prim names are sanitised to C identifiers (`[^A-Za-z0-9_]` becomes `_`, a
leading digit gets an underscore prefix). **Never take an id from a prim name.**
The id is always written separately as `riser:*:id`, and that is the only place
to read it from.

### `/Riser`

| Attribute | Type | Meaning |
|---|---|---|
| `riser:docVersion` | `string` | Schema version, currently `"1.0.0"`. |
| `riser:template` | `string` | Template id the document was authored against. |
| `riser:name` | `string` | Display name. |

### `/Riser/Character`

A typeless `def` whose only content is the reference:

```usda
def "Character" (
    prepend references = @./character.usdc@
)
{
}
```

The asset path lives in composition metadata, not in an attribute. In OpenUSD,
read it off the prim stack (`prim.GetPrimStack()`, then each spec's
`referenceList`).

### Guides: `/Riser/Guides/<name>`

```usda
def Xform "wristL"
{
    double3 xformOp:translate = (0.62, 1.1, 0)
    uniform token[] xformOpOrder = ["xformOp:translate"]

    uniform token riser:guide:id          = "wristL"
    uniform token riser:guide:group       = "armL"
    float3        riser:guide:normal      = (0, 0, 1)
    uniform token riser:guide:source      = "user"
    float         riser:guide:confidence  = 1
    uniform token riser:guide:bound       = "surface"
    rel           riser:guide:bindPrim    = </Riser/Character/Geom/Body>
    int           riser:guide:faceIndex   = 12043
    float3        riser:guide:barycentric = (0.21, 0.34, 0.45)
    float3        riser:guide:offset      = (0, 0, 0)
}
```

| Attribute | Type | Meaning |
|---|---|---|
| `xformOp:translate` | `double3` | The authored position. A hint; see below. |
| `xformOpOrder` | `uniform token[]` | Always `["xformOp:translate"]`. Idiomatic USD placement, so guides show up correctly in any USD tool. |
| `riser:guide:id` | `uniform token` | Template guide id. Unique in the document. **A child prim without this is not a guide** and should be skipped. |
| `riser:guide:group` | `uniform token` | Template group id. Checklist grouping only. |
| `riser:guide:normal` | `float3` | Surface normal at the pick, for orienting what gets built here. |
| `riser:guide:source` | `uniform token` | `user`, `skeleton`, `proportions` or `landmarks`. Absent on layers written before provenance existed; default to `user`. |
| `riser:guide:confidence` | `float` | 0..1. Default 1.0. Always 1.0 for `user`. |
| `riser:guide:bound` | `uniform token` | `"surface"` or `"none"`. Written explicitly so "placed free in space" is distinguishable from "written by an older version". Anything other than `"surface"` means no binding, and the remaining four attributes are absent. |
| `riser:guide:bindPrim` | `rel` | Single target: the bound mesh's prim path. |
| `riser:guide:faceIndex` | `int` | **Triangle** index. See below. |
| `riser:guide:barycentric` | `float3` | Weights inside that triangle. Components sum to 1. |
| `riser:guide:offset` | `float3` | Displacement from the evaluated surface point. Zero for on-surface guides; non-zero for guides that belong inside the volume, such as hip, shoulder and elbow centres. |

A binding is only valid when `bound == "surface"` **and** `bindPrim` has a
target **and** `faceIndex >= 0`. Anything else is an unbound guide.

### Curves: `/Riser/Curves/<name>`

A real `BasisCurves` prim, so the curve renders in any USD tool, plus parallel
`riser:curve:` arrays carrying one binding per control vertex.

```usda
def BasisCurves "jawline"
{
    uniform token type   = "cubic"
    uniform token basis  = "bspline"
    uniform token wrap   = "nonperiodic"
    int[] curveVertexCounts = [5]
    point3f[] points = [(0.005, 1.57, -0.052), ...]
    float[] widths = [0.004]
    uniform token[] primvars:widths:interpolation = ["constant"]

    uniform token riser:curve:id     = "jawline"
    uniform token riser:curve:group  = "face"
    bool          riser:curve:closed = false
    float3[]      riser:curve:normals       = [(0, 0, 1), ...]
    string[]      riser:curve:bindPrims     = ["/Riser/Character/Geom/Head", ...]
    int[]         riser:curve:faceIndices   = [84, 148, 212, 275, 339]
    float3[]      riser:curve:barycentrics  = [(0.33, 0.33, 0.33), ...]
    float3[]      riser:curve:offsets       = [(0, 0, 0), ...]
}
```

| Attribute | Type | Meaning |
|---|---|---|
| `type` | `uniform token` | Always `"cubic"`. |
| `basis` | `uniform token` | Always `"bspline"`. |
| `wrap` | `uniform token` | `"periodic"` for a closed curve, `"nonperiodic"` otherwise. Redundant with `riser:curve:closed`, and present so the prim renders correctly in a USD tool that knows nothing about Riser. |
| `curveVertexCounts` | `int[]` | One entry: the control vertex count. Riser writes one curve per prim. |
| `points` | `point3f[]` | Authored control vertex positions. Hints, exactly like a guide's translate. |
| `widths` | `float[]` | One constant width, in stage units. |
| `primvars:widths:interpolation` | `uniform token[]` | `["constant"]`. |
| `riser:curve:id` | `uniform token` | Curve id. A child prim without it is not a curve. |
| `riser:curve:group` | `uniform token` | Template group id. |
| `riser:curve:closed` | `bool` | Whether the curve loops. |
| `riser:curve:normals` | `float3[]` | One per control vertex. |
| `riser:curve:bindPrims` | `string[]` | Prim path per control vertex. **A plain string array, not a relationship**, because USD relationships cannot express per-element targets. Empty string means unbound. |
| `riser:curve:faceIndices` | `int[]` | Triangle index per control vertex. `-1` means unbound. |
| `riser:curve:barycentrics` | `float3[]` | Weights per control vertex. |
| `riser:curve:offsets` | `float3[]` | Offset per control vertex. |

All six `riser:curve:` arrays are parallel to `points`. A control vertex is
bound only when its `bindPrims` entry is non-empty **and** its `faceIndices`
entry is `>= 0`. A tolerant reader should treat a short array as defaulted
rather than as an error.

### Positions are hints. Bindings are the truth.

`xformOp:translate` and `points` were computed in a browser, in float32,
against whatever geometry it had loaded at the time. They are stored so the
document opens in usdview looking right, and so a reader with no geometry has
something to show. **Resolve the binding instead.**

```
resolved = evaluate(bindPrim, faceIndex, barycentric) + offset
```

where `evaluate` is `a*u + b*v + c*w` over the triangle's three vertices.

### Triangle indices: the one thing to get right

`faceIndex` indexes a **triangle**, after triangulation, counted globally
across the whole mesh rather than restarted per face. It does not index USD's
`faceVertexCounts`.

The triangulation is three.js's, because that is where the browser got the
index. Reproduce it exactly:

| face | becomes |
|---|---|
| 3 corners | one triangle, unchanged |
| 4 corners | a fan from the first corner: `(0,1,2)`, `(0,2,3)` |
| 5+ corners | three.js ear-clips. **Riser refuses these.** |

The `(0,2,3)` diagonal is not a detail. Splitting a quad the other way
`(0,1,3),(1,2,3)` puts every second binding on a different triangle.

This package refuses n-gons rather than guessing, because a subtly different
ear clipper is worse than no clipper: it fails silently on a handful of faces
instead of loudly on all of them. Triangulate meshes on the way into your
pipeline. A mesh that cannot be triangulated compatibly is left out of
`meshes`, and validation reports it as `no-geometry` when nothing usable is
left.

### Coordinate space

Positions are expressed relative to the **referenced asset's root**, not the
world.

Between the two sit three transforms that exist only for display in the
browser: the units scale and up-axis flip three's composer applies, and a
ground-align and recentre for framing. None of them exist on the stage you
open, so document space is the asset's own space.

Conversely, transforms **inside** the asset do count. This package bakes each
mesh prim's accumulated local-to-world transform into its points before
evaluating, so a head offset onto a body, or parts placed into an assembly,
resolve where the artist put them. If you write your own reader, do the same,
or every guide on such a character will be wrong by exactly that transform.

### Prim paths are layer paths

The browser sees `/Character/Geom/Body` in the asset. After the layer
references the asset onto `/Riser/Character`, that mesh is at
`/Riser/Character/Geom/Body`, and **that** is what `bindPrim` names. Resolve
binding paths against the composed layer, not against the asset opened on its
own.

### Subdivision is invisible here

Riser's viewport displays a Catmull-Clark limit surface, but a binding always
names a triangle of the **control cage**, which is the actual USD mesh. The gap
between cage and limit surface rides in the binding's `offset`. Because
`position = evaluate(binding) + offset` already holds, a reader recovers the
exact clicked point with no subdivision code at all. Nothing about subdivision
appears in the format, and you do not need to handle it.

---

## Worked examples

### Export guide positions for a rig build

```python
from riser_worker import RiserLayer

layer = RiserLayer.open("hero.usda")
report = layer.validate("biped")
if not report.ok:
    for issue in report.errors:
        print(f"{issue.code}: {issue.message}")
    raise SystemExit(1)

joints = {
    guide.id: guide.position
    for guide in layer.guides()
    if guide.resolved and guide.confidence >= 0.5
}
```

### Only act on what a person placed

```python
hand_placed = [g for g in layer.guides() if g.source == "user"]
```

Auto-placement runs repeatedly, on load and on template change. Provenance is
what lets a downstream fit improve its own previous guesses while leaving hand
work alone.

### Inside Maya

```python
import maya.cmds as cmds
from riser_worker import RiserLayer

layer = RiserLayer.open(layer_path)
for guide in layer.guides():
    if not guide.resolved:
        cmds.warning(f"{guide.id}: binding did not resolve, using authored position")
    locator = cmds.spaceLocator(name=f"riser_{guide.id}")[0]
    cmds.xform(locator, translation=guide.position, worldSpace=True)
```

Positions are in the asset's own space and in stage units. Scale by
`layer.document.meters_per_unit` if your scene works in different units, and
account for `layer.document.up_axis` if your scene is Z-up.

### A shell gate, no Python

```bash
set -e
riser validate "$LAYER" --template auto           # exits 1 on any error
riser resolve  "$LAYER" --json > guides.json
```

### Batch a directory

```bash
for layer in layers/*.usda; do
  if riser validate "$layer" --template auto > /dev/null 2>&1; then
    riser export-json "$layer" -o "out/$(basename "$layer" .usda).json"
  else
    echo "FAILED $layer" >&2
  fi
done
```

---

## Things that will bite you

- **A guide with `resolved: false` still has a position.** It is the authored
  one, kept so a naive consumer is not handed a `None` it will not check for.
  If correctness matters, check the flag.
- **`ValidationReport.guides` is not `layer.guides()`.** The report omits
  guides it cannot vouch for. `layer.guides()` returns the whole roster.
- **`asset_path` on the HTTP endpoints is not optional in practice.** Riser
  writes relative character references, and a relative reference cannot resolve
  for a layer that was never written to the right directory.
- **`meters_per_unit` defaults to 0.01 in the browser** but the layer always
  states it. Read it; do not assume metres.
- **An empty `mesh_paths` with many unresolved guides means the reference did
  not compose**, not that the document is broken. Check the asset path first.
- **N-gons are refused, not approximated.** If a character has faces with five
  or more corners, triangulate before authoring guides against it.
