# Changelog

## [0.6.0] - 2026-08-31
- Placement modes — a click can mean the surface, the centre of the volume, or a free point in space
- Centre placement is measured from the geometry, so it is right on a thin wrist and a heavy thigh on the same character
- Auto placement mode follows the template: joints go inside the body, everything else on the skin
- Free placement drags in the plane of the screen instead of sticking to the mesh
- Four HDR lighting environments — Studio, Day, Sunset and Night — the same set and images the Eye widget uses
- A low sunset key rakes across a character, which is what makes a crease or a joint pit readable when placing
- Photographed lighting can be switched off for a generated sky — cleaner, more neutral, and needs no download
- Version pill beside the Riser wordmark; clicking it shows what changed
- In-app changelog, read from the same CHANGELOG.md everyone edits
- Depth readout in the details panel — "on the surface", or how far inside
- Menu bar (File, Edit, View, Template, Help) carrying every action, including what the toolbar has no room for
- Searchable template browser with All / Left / Suggested / Mine filters, collapsible groups and per-group progress
- Step-by-step guidance, on by default and switchable off for good — one marker to place at a time, with its hint
- Right-click menus in the viewport and on marker rows
- Resizable, collapsible panels that remember their size between visits
- Shading collapsed into one dropdown; visibility grouped under an eye menu that counts what is hidden
- Skeleton display — Riser could read a rig but never show one
- Quadruped automatic placement — four-legged characters are measured along their length rather than their height
- Gary added as a bundled character: a production asset, 34 meshes, 137k triangles, no rig
- tools/mb-to-usd.py converts Maya scenes to USD through mayapy
- Smoothing starts at 0, so a character appears exactly as its file describes it
- Every smoothing level visited is cached — returning to one is instant rather than a fresh refinement
- Smoothing is budgeted across the whole character rather than per mesh, and says so when a level was reduced
- Unshaded characters get a neutral clay material instead of rendering as a black silhouette
- Fixed: choosing a template wrote the document but not the interface, so a horse under the Quadruped template was still measured as a person
- Fixed: centre placement measured nothing at all — back faces are culled when raycasting a front-facing material, so the far side was never found
- Fixed: centre placement on a clothed character measured the gap between the clothes and the skin
- Fixed: centre placement on a character authored in centimetres was applied a hundred times too small
- Fixed: curves placed inside the body were pulled back onto the surface by the display projection
- Fixed: automatic placement refused stylised characters by treating leg length as diagnostic of a biped
- Fixed: mirrored placement measured the other limb independently, so a symmetric pair landed centimetres apart in depth
- Fixed: the end-to-end suite served whatever was last built rather than the working tree
- Fixed: the reference-render test compared against a Windows baseline and could never pass on Linux CI
- package.json is now the single source of truth for the version; version.json is generated from it at build

## [0.5.0] - 2026-08-30
- First release of Riser as a character setup application, replacing the OBJ viewer prototype
- USD-first document model — markers and curves stored as a layer that references the character rather than modifying it
- Every marker is bound to a triangle, so it survives a retopo or a mesh swap
- Imperative three.js viewport kept outside React, with marker and curve tools, symmetry and x-ray
- Automatic placement from a character's own skeleton, and from measuring one without a rig
- Squarebit Subdivs in the viewport — place on a smooth limit surface while bindings stay on the control cage
- Lit, flat, wireframe and lit-wireframe shading
- Document library — name, save and reopen — plus session restore across a reload
- Python worker with a CLI and a developer API, resolving bindings against real geometry with OpenUSD
- User documentation and a format specification
- Biped, quadruped and face templates
- Import from USD, glTF, FBX and OBJ; export as a USD layer

## [0.4.1] - 2026-08-29
- The OBJ viewer prototype, kept in history on main. Unrelated to the current application beyond the name.
