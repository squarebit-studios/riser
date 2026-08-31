# The interface

Riser has four regions and a status strip. Nothing is hidden in a menu.

![The whole window, with the four regions](images/overview.png)

- The **toolbar** across the top: what you are working on and how it is shown.
- The **checklist** down the left: what to place, and what is next.
- The **viewport** in the middle: where you click.
- The **inspector** down the right: what exactly is selected.
- The **status bar** along the bottom: what to do next, and anything the app
  needs to tell you.

## Toolbar

![The toolbar](images/toolbar.png)

Left to right.

| Control | What it does |
|---|---|
| **Stock character** | Loads one of the bundled characters: Biped (blockout), Quadruped (blockout), Biped (rigged). |
| **Upload** | Opens a file picker for your own character. Accepts `.usd`, `.usda`, `.usdc`, `.usdz`, `.glb`, `.gltf`, `.fbx`, `.obj`. |
| **Template** | Which rig layout to place: Biped, Quadruped or Face only. Changing it drops anything the new template does not define. |
| **Markers** / **Curves** | Switches the active tool. Also `1` and `2`. |
| **Symmetry** | Mirrors placements across the character's centre line, and shows the symmetry plane in the viewport. On by default. Also `S`. |
| **X-ray** | Draws markers and curves through the mesh. On by default. Also `X`. |
| **Subdiv** | Catmull-Clark preview level, 0 to 3. Display only: it never moves a marker you have placed. The number turns amber when the level had to be reduced for a dense mesh. |
| **Auto-place** | Fills in guides automatically: from the character's own skeleton when it has one, otherwise by measuring its shape. Disabled until a character is loaded. Never overwrites anything you placed. |
| **Undo** / **Redo** | Steps the document history. The tooltip names the step, for example *Undo Place Chest*. |
| **Frame** | Frames the whole character. |
| **Open** | Loads a Riser document back in. Accepts `.usda` and `.usd`. |
| **Export USD** | Downloads the document as a `.usda` layer. A bullet after the label means there are unexported changes. |

## Checklist

![The guide checklist](images/checklist.png)

The left rail lists everything the current template asks for, grouped by body
part. It follows the active tool: guides while the marker tool is active,
curves while the curve tool is.

The highlighted row is the **active** entry, and it is what your next click on
the mesh will place. Click a row to make it active. After you place something,
the next unplaced entry becomes active by itself.

The percentage and the bar at the top count **required** guides only, so a
template can read 100% with optional guides still unplaced.

Each row carries a dot on the left:

| Dot | Meaning |
|---|---|
| Hollow ring | Not placed yet. |
| Amber | The active entry. Your next click places this. |
| Blue | Placed by you. |
| Violet | Placed automatically and not yet confirmed. Worth checking. |

And badges on the right:

| Badge | Meaning |
|---|---|
| **IN** | Interior. This guide belongs inside the volume, not on the skin. Alt-drag sets its depth. |
| **OPT** | Optional. Not counted in the progress bar. Hidden once placed. |
| A number | Curves only: how many control vertices the curve has so far. |

Group headings show how many of that group's guides are placed, such as `6/8`.

![The curve checklist](images/curve-checklist.png)

## Viewport

The viewport shows the character, a ground grid sized to fit it, and the
symmetry plane when symmetry is on.

**Camera.** Drag with the left button on empty space to orbit, drag with the
right button to pan, and use the wheel to zoom. Pressing and releasing without
moving is a click, and places rather than orbits.

**Clicking.** What a click does depends on the active tool and what is under
the pointer. See [Keyboard and mouse](keyboard.md) for the full table.

**Dropping a file.** Drag a character file anywhere onto the viewport and a
dashed outline appears; drop it to load. A file Riser does not read is refused
by name, with the supported list in the message.

**Messages.** A load in progress shows a small caption at the top. An error
shows a panel at the bottom with a **Dismiss** button, and stays until you
dismiss it.

## Inspector

![The inspector, showing a guide's binding](images/inspector.png)

The right panel has three sections. The middle one follows the active tool.

### Character

What Riser read from the file you loaded.

| Field | Meaning |
|---|---|
| **Asset** | The file name of the loaded character. |
| **Units** | Metres per unit, as the asset declares it. |
| **Up axis** | `Y` or `Z`. |
| **Skeleton** | `present` or `none`. With a skeleton, Auto-place reads exact joint positions; without one it measures the shape instead, which is approximate. |
| **Subdivision** | The preview level and the face counts, as *level 2 - 15,136 faces from ...* the cage count. Reads *off* with the cage count at level 0. |

### Selection, with the marker tool

The heading is the selected guide's label, followed by the template's hint for
it.

| Field | Meaning |
|---|---|
| **Id** | The guide's id in the document, such as `chest`. |
| **Group** | Its checklist group. |
| **Placement** | Shown for interior guides only, as a reminder that alt-drag sets depth. |
| **Source** | *placed by you*, or the automatic source with its confidence. |
| **Position** | The resolved position, in the character's own space. |
| **Bound to** | The USD prim path of the mesh it is bound to, or *nothing - free in space*. |
| **Face** | The triangle index within that mesh. |
| **Barycentric** | Where inside that triangle, as three weights that sum to 1. |
| **Offset** | Displacement from the surface point. Non-zero for interior guides. |
| **Nearest joint** | The closest joint of the character's rig and how far away it is. Shown only when the character has a skeleton. |

The binding fields are deliberately visible. When a marker ends up somewhere
unexpected, they are the thing that explains why.

**Focus** moves the camera to the guide. **Remove** deletes it.

### Selection, with the curve tool

| Field | Meaning |
|---|---|
| **Id** | The curve's id, such as `jawline`. |
| **Suggested points** | How many control vertices the template suggests. You are not held to it. |
| **Control vertices** | How many the curve has. |
| **Closed** | Whether it is a loop. |
| **Width** | The curve's width, written into the USD layer as `widths`. This is the width the exported curve has, not the thickness of the line on screen. |

**Close** / **Open** toggles the loop, the same as pressing `C`. **Remove**
deletes the whole curve.

### Document

A running total: the template, how many guides are placed, how many curves are
started, and how many control vertices there are altogether.

## Status bar

![The status bar](images/statusbar.png)

Left to right:

- **What to do next.** *Click the character to place Chest.* When every required
  guide is placed it says so and suggests exporting.
- **Notices** replace that text in amber when something needs saying, such as a
  mirrored guide that could not find a surface. They clear themselves after a
  few seconds.
- **The last edit**, which is also what Undo will step back, or *No edits yet*.
- **Saved** or **Unsaved changes**.
- A **shortcut reminder** on wide windows.
