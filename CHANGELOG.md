# Changelog

A summary of what is new in each release of Riser.

## [0.14.2] - 2026-09-01

### Fixed
- A drawn curve goes through the points you placed again. It had become a quadratic, which approaches its middle control vertices rather than touching them, so the line visibly missed the points it was drawn from. That was a workaround for eyelids coming out as a wobble, and the wobble had a different cause which is now fixed, so the interpolating curve is back and the quadratic remains available
- Re-seating a curve onto the surface no longer drags it off the points. The search either side of the curve was a fraction of the whole character, which is centimetres, while a lid is traced with points a couple of millimetres apart and an eye directly behind it. The search is now the smaller of what the character allows and half the gap between the points, so a wide jawline is unaffected and a tight trace is corrected by tight amounts
- Placed points are held still while the rest of the curve is re-seated, which follows from the interpolating curve having a sample sitting on each one

## [0.14.1] - 2026-09-01

### Fixed
- Curves drew wrongly, scattering while they were being drawn and reloading as a tangle. Each sample searches for the surface along a normal, and the samples and the normals were built by two different parameterisations. They agreed while the curve was a cubic and stopped agreeing the moment it became a quadratic, because the two spread their control values differently, so every sample was searching along a normal taken from somewhere else on the curve. Around an eye or a lip, where the surface turns fast and another surface sits just behind it, a slightly wrong direction finds a different piece of the character and the sample snaps there
- Directions are now built by the same resampler as the positions, so sample and direction are the same point on the curve whatever degree it is drawn at

## [0.14.0] - 2026-09-01

### Added
- A Select tool, for moving what is already placed. Press on a marker or a curve control vertex and it is selected and dragged, with the same surface re-seating, binding rewrite, alt to lift and mirroring the creating tool gives it. What changes is the miss: a press that lands on nothing belongs to the camera, so adjusting something no longer means every stray click leaves a new marker or another curve point behind. It is `1`, and markers and curves move to `2` and `3`
- The viewport says which mode it is in, in its top right corner, and says it as the consequence rather than the name: *click the character to place*. The toolbar already carried this and it was a small button at the top of the window, nowhere near where anyone is looking when they click. Placing modes are tinted to match what they create, and Select is quiet, because the point of it is that clicking is safe

## [0.13.3] - 2026-09-01

### Changed
- Curves are drawn as degree two by default. A cubic is steered by two control vertices past each end of the span it is drawing, so a point placed slightly off pulls the curve around spans it is not next to, and the curve can swing wider than the points that made it. That is invisible on a jawline and it is the wobble you get on an eyelid, where the points are close together and the surface turns hard. A quadratic span sees three consecutive points and stays inside them, so it cannot swing wide
- An open curve still starts and finishes exactly on its first and last control vertex. The middle ones are approached rather than touched, which is what the quadratic trades for staying contained

## [0.13.2] - 2026-09-01

### Fixed
- Drawing a curve got slower with every curve already on the character. Any change to the document re-projected all of them onto the surface, so moving one control vertex paid to re-cast every sample of every other curve as well. Only curves that actually moved are projected now, and a curve is projected again when the skin under it moves, which is what changing subdivision level or firing a blend shape does
- Projecting a curve considered every piece of the character for every sample. A curve is local, so it now tests only the pieces close enough to reach: measured at 2.2x faster for a five point curve and 2.7x for a twenty one point one, returning the same points to the last bit

## [0.13.1] - 2026-09-01

### Fixed
- The Maya exporter shipped geometry the character does not have. It decided what to leave out by naming the scaffolding it knew about, which meant anything it did not recognise was kept without anyone being told: four hidden proxy meshes sitting on top of the real brows and lashes, and an entire second character under a root no rule had heard of, carrying a body heavier than the real one. It now keeps what is in the model group and visible in Maya, and drops the rest, along with any material left with nothing to shade
- Hidden geometry is removed rather than exported and marked invisible. USD records visibility faithfully and three's USD composer ignores it, so a hidden mesh was drawn anyway by anything reading the file in a browser

## [0.13.0] - 2026-09-01

### Fixed
- An exported curve described a different shape from the one on screen. It was written as a B-spline, whose control points the curve is pulled towards and passes through none of. Riser's control vertices are bound to triangles of the character and are the curve itself, so it is now written with the basis that interpolates them
- Every control vertex is on the exported curve. A cubic USD curve spends its first and last points as tangents rather than positions, so five vertices drew two segments between the second and fourth. The ends are repeated, giving one segment per span you placed
- The worker and the reader both give back the vertices that were placed rather than the two extra the format needs

## [0.12.7] - 2026-09-01

### Fixed
- The wireframe followed a blend shape at every smoothing level except 0. Above 0 it is drawn from a surface that gets re-evaluated when the cage moves; at 0 it is drawn from the cage's own quads, which were cached at rest and never moved

## [0.12.6] - 2026-09-01

### Added
- **Recompute normals**, in the blend shape panel. Off, a character keeps the shading its file shipped with, which is free and exactly what the artist authored but does not follow a strong shape. On, the normals are turned by however far the surface turned, so a bulge lights like one. The same choice Unreal makes for shapes that drive normals
- The turn is applied to each authored normal rather than replacing it, so hard edges survive: a file gives split vertices different normals where it wants a crease, and rebuilding smooth normals erases every one of them

## [0.12.5] - 2026-09-01

### Fixed
- Firing a blend shape no longer changes how the character is shaded at all. It keeps the normals the file shipped with, hard edges and all, rather than deriving new ones: every way of deriving them either faceted the mesh, erased the creases the artist authored, or lit the surface inside out
- The wireframe follows a shape instead of being left behind in the pose the character used to be in. Its lines are their own geometry, built from the surface as it was, and nothing was rebuilding them when the surface moved

## [0.12.4] - 2026-09-01

### Fixed
- Firing a blend shape left the character permanently faceted, its triangulation showing through as hard flat faces. Shading was being derived with a method that averages across vertices, and a renderer's geometry shares none of them, so every normal came out per triangle. It was most obvious at level 0, where you are looking at that mesh rather than at a smoothed surface built from it
- Clearing a shape now puts the file's own normals back exactly, and a shape that is applied is shaded smoothly across the faces the file authored

## [0.12.3] - 2026-09-01

### Fixed
- Meshes a USD marks invisible are now hidden on load. Gary authors four proxy meshes invisible because they are coincident duplicates of the brows and lashes, and drawing them anyway made those flicker against their own copies
- Visibility is inherited, so a mesh under a prim the file switches off is hidden too, which is how a rig turns whole groups off in one place

### Changed
- What the file hides is the starting state of the Scene tab rather than a rule: the pieces are listed as hidden and can be turned back on, so you can still see what a character was keeping out of the way

## [0.12.2] - 2026-09-01

### Fixed
- A character loaded with smoothing already on came up unsmoothed and stayed that way until the control was toggled off and on. The interface reported the level it was meant to be at while the surface was still the unsmoothed cage, so the two disagreed with nothing to say which was right

## [0.12.1] - 2026-08-31

### Fixed
- The blend shape panel did not appear at all on a character that had them. Reading shapes means fetching the character file back, so they arrive after the character does, and the panel built its list before that and never looked again

## [0.12.0] - 2026-08-31

### Added
- Gary now ships with his blend shapes: 932 of them, 462 shared across more than one mesh so a single control moves the face, the gums and the teeth together
- The bundled character carries only what is under its model group, so rig scaffolding no longer travels with it

### Changed
- That character is 21.8MB rather than 6.5MB, which is what carrying a face rig's worth of shapes costs. Loading shows how much has arrived and can be cancelled

## [0.11.0] - 2026-08-31

### Added
- Blend shapes are evaluated in the vertex shader while a weight is moving, so dragging a slider costs one small upload rather than recomputing every moved vertex. Measured on a production body, twenty steps of a drag went from 218ms to 0ms
- The processor takes over the moment the value stops moving, because a vertex shader cannot relight what it displaces and cannot feed the smoothed surface. So a drag is instant and what it settles into is fully correct, with normals and smoothing right
- Falls back to the processor entirely where the graphics path is not available, and for any mesh it cannot accelerate

## [0.10.1] - 2026-08-31

### Fixed
- A blend shape did nothing visible while smoothing was on. The shape moved the control cage and the smoothed surface is built FROM that cage, so it stayed exactly where it was. The surface is now re-evaluated from the moved points, which is one sparse matrix product rather than a rebuild

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
