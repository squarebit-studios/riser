# Changelog

## [0.7.2] - 2026-08-31
- Markers place instantly again on heavy characters: 1.7s down to under 0.2s on a 137k-triangle production character
- Raycasting is now accelerated with a bounding volume hierarchy, so picking cost barely grows with triangle count
- Alt+right drag zooms sideways as well as up and down, the way Maya does
- Animation tab in the right panel. Play a clip on the loaded character and scrub it, to check your markers against motion
- Clips a character shipped with are found on load; clips from another file can be added, and one that names bones the character does not have is refused with the names it wanted rather than played silently
- Bundled animated biped, so there is something that moves out of the box
- Note while a clip plays: markers stay where the resting mesh put them, because a binding names a triangle of the neutral character
- A clip is opt-in. A character that ships with animation now loads at its rest pose, because a marker belongs on the neutral character and every automatic placement measures the resting silhouette
- Subdivision keeps a mesh's material groups, so a character whose body and clothing share one mesh no longer vanishes when smoothing is turned on
- Fixed: the blend shape panel was being rendered inside every labelled row of the inspector

## [0.7.0] - 2026-08-31
- Gary is now a rigged, textured production character: 482 joints, clothing over skin, and 46 of 49 markers placed exactly from his own skeleton
- Studio rig naming is understood: `_bind`, `_jnt` and similar suffixes are ignored, and twist, bend and roll chains are never mistaken for real joints
- A rig carrying both a clavicle and a shoulder now gets both right, without breaking conventions where "shoulder" means the clavicle
- Face joints (chin, nose, ears, mouth corners) are matched when a rig names them anatomically
- Maya navigation: Alt+left tumbles, Alt+middle pans, Alt+right zooms. The plain bindings still work without Alt, so no modifier is required to look at anything
- Blend shape panel. Fire a character's shapes to check your markers still sit right when the face moves; nothing there changes the document
- Touch: a long press opens the viewport menu, since an iPad has no right button. Pinch and two-finger gestures are untouched
- Fixed: a right drag panned the camera AND opened the viewport menu, over the very thing you had just moved into view
- Fixed: placing a marker jumped the selection to the next unplaced guide, so a nudge to what you just placed moved a different guide entirely. The marker stays selected; Next advances

## [0.6.0] - 2026-08-31
- Placement modes: a click can mean the surface, the centre of the volume, or a free point in space
- Centre placement is measured from the geometry, so it is right on a thin wrist and a heavy thigh on the same character
- Auto placement mode follows the template: joints go inside the body, everything else on the skin
- Free placement drags in the plane of the screen instead of sticking to the mesh
- Four HDR lighting environments (Studio, Day, Sunset and Night), the same set and images the Eye widget uses
- A low sunset key rakes across a character, which is what makes a crease or a joint pit readable when placing
- Photographed lighting can be switched off for a generated sky, which is cleaner, more neutral, and needs no download
- Version pill beside the Riser wordmark; clicking it shows what changed
- In-app changelog, read from the same CHANGELOG.md everyone edits
- Documentation is now in the app, under Help: six pages with images, searchable, and "?" opens it
- Dev server changes to viewport or tool code now force a full reload, instead of leaving the app running old code
- Depth readout in the details panel: "on the surface", or how far inside
- Menu bar (File, Edit, View, Template, Help) carrying every action, including what the toolbar has no room for
- Searchable template browser with All / Left / Suggested / Mine filters, collapsible groups and per-group progress
- Step-by-step guidance, on by default and switchable off for good: one marker to place at a time, with its hint
- Right-click menus in the viewport and on marker rows
- Resizable, collapsible panels that remember their size between visits
- Shading collapsed into one dropdown; visibility grouped under an eye menu that counts what is hidden
- Skeleton display. Riser could read a rig but never show one
- Quadruped automatic placement: four-legged characters are measured along their length rather than their height
- Gary added as a bundled character: a production asset, 34 meshes, 137k triangles, no rig
- tools/mb-to-usd.py converts Maya scenes to USD through mayapy
- Smoothing starts at 0, so a character appears exactly as its file describes it
- Every smoothing level visited is cached, so returning to one is instant rather than a fresh refinement
- Smoothing is budgeted across the whole character rather than per mesh, and says so when a level was reduced
- Unshaded characters get a neutral clay material instead of rendering as a black silhouette
- Fixed: choosing a template wrote the document but not the interface, so a horse under the Quadruped template was still measured as a person
- Fixed: centre placement measured nothing at all. Back faces are culled when raycasting a front-facing material, so the far side was never found
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
- USD-first document model: markers and curves stored as a layer that references the character rather than modifying it
- Every marker is bound to a triangle, so it survives a retopo or a mesh swap
- Imperative three.js viewport kept outside React, with marker and curve tools, symmetry and x-ray
- Automatic placement from a character's own skeleton, and from measuring one without a rig
- Squarebit Subdivs in the viewport: place on a smooth limit surface while bindings stay on the control cage
- Lit, flat, wireframe and lit-wireframe shading
- Document library (name, save and reopen), plus session restore across a reload
- Python worker with a CLI and a developer API, resolving bindings against real geometry with OpenUSD
- User documentation and a format specification
- Biped, quadruped and face templates
- Import from USD, glTF, FBX and OBJ; export as a USD layer

## [0.4.1] - 2026-08-29
- The OBJ viewer prototype, kept in history on main. Unrelated to the current application beyond the name.
