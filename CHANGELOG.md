# Changelog

A summary of what is new in each release of Riser.

## [0.10.0] - 2026-08-31

### Added
- Blend shapes on a USD character can be fired from the panel. Three's USD loader does not read them at all, so Riser reads them itself, and keeps them sparse: the character used for this carries 878 shapes on the body alone, which as ordinary morph targets would be about 1.6GB for that one mesh
- A shape name shared by several meshes is one control that drives all of them. On this character 462 of 932 names are on more than one mesh, because a jaw shape has to move the gums and the teeth along with the face
- The panel lists shapes from a USD and from a glTF or FBX the same way, because which file a shape came from is Riser's problem rather than yours

## [0.9.5] - 2026-08-31

### Fixed
- The Smooth button did nothing on its own. The level it applied defaulted to 0, so turning smoothing on lit the button and left the character exactly as it was. It now goes to level 1, and level 0 stays reachable by choosing it from the menu, where picking it means something
- The concepts page still described a subdivision slider defaulting to level 2. It has been a button and a menu since 0.8.1, and smoothing is off when a character arrives

### Changed
- Blend shapes can ship beside a character instead of inside it, which keeps a hosted character at 6.5MB rather than 21.8MB. One file stays what a person handles: splitting only helps an asset served over the web
- The converter exports what is under the model group and nothing else, so rig scaffolding cannot reach the file even when somebody invents a new kind of it

## [0.9.4] - 2026-08-31

### Fixed
- Textures no longer stretch when smoothing is turned on. The UVs were being split flat across each original polygon while the vertices were being smoothed, so every refined point carried the UV of where it used to be rather than where it went. On Gary's body the texture sat up to 2.2e-3 out in UV space, about nine texels of a 4K map, and worst exactly where the polygons are irregular, which is the face. The UVs are now refined with the same rules as the mesh, and the measured error is float noise
- UV seams stay put. An island boundary is kept exactly as authored, so the two sides of a seam cannot drift apart, which matches the Unreal plugin's default and Maya's Preserve Map Borders: Internal

### Changed
- Squarebit Subdivs 0.10.0, which is where the fix lives. Refining the UV channel as well as the positions roughly doubles the cost of building a level: Gary's body at level 2 went from 410ms to 773ms, paid once per level and then cached

## [0.9.3] - 2026-08-31

### Added
- Loading a character shows what it is doing: how much has arrived out of how much there is, then that it is reading the file and building the character. A big asset is a long time to show a word and a full stop
- A load can be cancelled while it is downloading. Until now the only way out of one you did not mean to start was reloading the page, which threw the document away with it

### Changed
- Cancelling is treated as a decision rather than a failure, so it puts up no error

## [0.9.2] - 2026-08-31

### Fixed
- Blend shapes now survive the trip out of Maya. Asking mayaUSDExport for them wrote the names and the target relationships and no shapes at all: 878 of 878 targets on the body pointed at prims that were never created, and nothing reported it. The converter reads the sparse deltas Maya already holds and authors them itself

### Added
- Riser reads UsdSkel blend shapes, which three's USD loader does not. They stay sparse the whole way, because the body's 878 shapes as dense per-vertex deltas would be about 1.6GB for one mesh
- A shape name shared by several meshes is read as one shape, so one control can drive the face, the gums and the teeth together, which is what the name means

## [0.9.1] - 2026-08-31

### Added
- USD tab, showing the character's source file as the file describes itself: every prim, its type, and its attributes with their values. Searchable, and read-only, because Riser writes a layer that references the character and never modifies it
- The Scene tab now leads with the actor, the character as one thing, with its pieces folded underneath. Nothing is given up for it: every piece keeps the prim path a marker binds to and the worker resolves against

## [0.9.0] - 2026-08-31

### Changed
- Smoothing now subdivides the polygons the file actually contains, instead of guessing them back from the triangles three's USD loader hands over. Gary's body is 25,488 quads in the file; recovering them by inspection produced 28,246 faces, so about 11% stayed triangles and took an extraordinary vertex through the middle at every level. Those were the slivers across his cheek
- Every mesh in a USD character uses its own authored topology, materials and UVs included. A file that does not reconcile with the geometry built from it, and every glTF, FBX and OBJ, still uses the recovered quads

## [0.8.6] - 2026-08-31

### Fixed
- Every setting on an eye was being ignored. The 56 authored values have to be passed nested under `params`, and they were being spread at the top level where the module does not look for them, so each eye rendered with the widget's defaults: the iris and pupil came out at full size instead of the 0.8 and 0.7 the look asked for
- The pupil radius reaches the shader by a different route again, and was falling back to its default whatever a look authored
- The eyes stopped working the moment smoothing was touched. The view modes cache each mesh's own material the first time they see it, and the eyes arrive later than that, so turning smoothing on restored a material from before they existed
- Turning smoothing off left the wireframe drawing quads. Off means the renderer really is drawing triangles, so it now shows them again, and turning it back on returns to the level you had chosen

## [0.8.5] - 2026-08-31

### Changed
- Every entry in this changelog now carries an Added, Fixed or Changed label, in the app and in the docs, the same way the product changelogs on the store site do

## [0.8.4] - 2026-08-31

### Fixed
- The eyes projected their iris from the eyeball's own transform instead of from the projector the exporter recorded. The matrix was in the file the whole time and nothing was reading it. The projector now lands exactly on the eye centre on both eyes, where before it sat 1.7 metres away beside the origin

## [0.8.3] - 2026-08-31

### Fixed
- The eyes rendered black. The iris and sclera maps were being assigned to uniform names that do not exist, so they never reached the shader and it sampled nothing
- Hiding a piece in the Scene tab could not be undone. The list was cached against the character alone, so the row never learned it was hidden and clicking again hid it a second time

### Changed
- Smoothing is on or off independently of the level, so level 0 is a real choice: the mesh as the file describes it, drawn as quads rather than as its triangulation
- The Smooth button now reads accent blue when it is on and grey when it is off

## [0.8.2] - 2026-08-31

### Fixed
- The eyes were shaded but blank. Their iris and sclera maps are packed inside the .usdz, and Riser was looking for them beside it, so the shader ran with no textures. The dev server answered those requests with the app's own HTML instead of a 404, which is why nothing ever reported an error

## [0.8.1] - 2026-08-31

### Added
- Scene tab listing every piece a character is made of, with its triangle count and whether it is skinned
- Select a piece to see which one it is in the viewport, and hide it to reach whatever is underneath. On a clothed character that is how a hip marker gets onto the hip rather than the spacesuit
- Gary's eyes render as real Squarebit Eyes rather than white spheres. The look was always in the file: 56 attributes per eye, which nothing was reading

### Changed
- Smoothing is now a button with the level behind a menu, the way Unreal does it, instead of a slider. Turning it on returns to the level you last chose
- Wireframe follows the quads on a smoothed surface instead of the triangles it is drawn with, so the edge flow is readable rather than buried under diagonals

## [0.7.2] - 2026-08-31

### Added
- Animation tab in the right panel. Play a clip on the loaded character and scrub it, to check your markers against motion
- Clips a character shipped with are found on load; clips from another file can be added, and one that names bones the character does not have is refused with the names it wanted rather than played silently
- Bundled animated biped, so there is something that moves out of the box

### Fixed
- Markers place instantly again on heavy characters: 1.7s down to under 0.2s on a 137k-triangle production character
- Subdivision keeps a mesh's material groups, so a character whose body and clothing share one mesh no longer vanishes when smoothing is turned on
- The blend shape panel was being rendered inside every labelled row of the inspector

### Changed
- Raycasting is now accelerated with a bounding volume hierarchy, so picking cost barely grows with triangle count
- Alt+right drag zooms sideways as well as up and down, the way Maya does
- A clip is opt-in. A character that ships with animation now loads at its rest pose, because a marker belongs on the neutral character and every automatic placement measures the resting silhouette

### Notes
- While a clip plays, markers stay where the resting mesh put them, because a binding names a triangle of the neutral character

## [0.7.0] - 2026-08-31

### Added
- Gary is now a rigged, textured production character: 482 joints, clothing over skin, and 46 of 49 markers placed exactly from his own skeleton
- Studio rig naming is understood: `_bind`, `_jnt` and similar suffixes are ignored, and twist, bend and roll chains are never mistaken for real joints
- Face joints (chin, nose, ears, mouth corners) are matched when a rig names them anatomically
- Maya navigation: Alt+left tumbles, Alt+middle pans, Alt+right zooms. The plain bindings still work without Alt, so no modifier is required to look at anything
- Blend shape panel. Fire a character's shapes to check your markers still sit right when the face moves; nothing there changes the document
- Touch: a long press opens the viewport menu, since an iPad has no right button. Pinch and two-finger gestures are untouched

### Fixed
- A rig carrying both a clavicle and a shoulder now gets both right, without breaking conventions where "shoulder" means the clavicle
- A right drag panned the camera AND opened the viewport menu, over the very thing you had just moved into view
- Placing a marker jumped the selection to the next unplaced guide, so a nudge to what you just placed moved a different guide entirely. The marker stays selected; Next advances

## [0.6.0] - 2026-08-31

### Added
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
- Depth readout in the details panel: "on the surface", or how far inside
- Menu bar (File, Edit, View, Template, Help) carrying every action, including what the toolbar has no room for
- Searchable template browser with All / Left / Suggested / Mine filters, collapsible groups and per-group progress
- Step-by-step guidance, on by default and switchable off for good: one marker to place at a time, with its hint
- Right-click menus in the viewport and on marker rows
- Resizable, collapsible panels that remember their size between visits
- Skeleton display. Riser could read a rig but never show one
- Quadruped automatic placement: four-legged characters are measured along their length rather than their height
- Gary added as a bundled character: a production asset, 34 meshes, 137k triangles, no rig
- tools/mb-to-usd.py converts Maya scenes to USD through mayapy

### Fixed
- Choosing a template wrote the document but not the interface, so a horse under the Quadruped template was still measured as a person
- Centre placement measured nothing at all. Back faces are culled when raycasting a front-facing material, so the far side was never found
- Centre placement on a clothed character measured the gap between the clothes and the skin
- Centre placement on a character authored in centimetres was applied a hundred times too small
- Curves placed inside the body were pulled back onto the surface by the display projection
- Automatic placement refused stylised characters by treating leg length as diagnostic of a biped
- Mirrored placement measured the other limb independently, so a symmetric pair landed centimetres apart in depth
- The end-to-end suite served whatever was last built rather than the working tree
- The reference-render test compared against a Windows baseline and could never pass on Linux CI

### Changed
- Shading collapsed into one dropdown; visibility grouped under an eye menu that counts what is hidden
- Smoothing starts at 0, so a character appears exactly as its file describes it
- Every smoothing level visited is cached, so returning to one is instant rather than a fresh refinement
- Smoothing is budgeted across the whole character rather than per mesh, and says so when a level was reduced
- Unshaded characters get a neutral clay material instead of rendering as a black silhouette
- Dev server changes to viewport or tool code now force a full reload, instead of leaving the app running old code
- package.json is now the single source of truth for the version; version.json is generated from it at build

## [0.5.0] - 2026-08-30

### Added
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

### Notes
- The OBJ viewer prototype, kept in history on main. Unrelated to the current application beyond the name.
