# The interface

Riser has a menu bar, a toolbar, three panels and a status strip.

![The whole window](images/overview.png)

- The **menu bar** across the top: everything Riser can do. Every action
  appears here, whether or not it also has a button.
- The **toolbar** under it: the few things you reach for constantly.
- The **markers panel** down the left: what to place, and what is next.
- The **viewport** in the middle: where you click.
- The **details panel** down the right: what exactly is selected.
- The **status bar** along the bottom: what to do next, and anything the app
  needs to tell you.

Both side panels can be **resized** by dragging their inner edge, and
**collapsed** to a labelled rail by clicking the chevron in their header or
double-clicking that edge. Widths are remembered between visits.
**View › Reset panels** puts everything back.

## Menu bar

The toolbar can only hold what fits, so the menus hold everything. If you
cannot find a control, it is in a menu.

| Menu | What is in it |
|---|---|
| **File** | New, Save, Save as, the bundled characters, opening your own file, recent documents, importing a marker layer, and Export USD. |
| **Edit** | Undo, Redo, automatic placement, confirming suggestions, mirroring, and clearing markers or curves. |
| **View** | Shading, what is drawn, step-by-step guidance, framing, and resetting the panels. |
| **Template** | Which rig layout to place: Biped, Quadruped or Face only. |
| **Help** | Documentation, and the keyboard shortcuts. |

Items you cannot use right now are shown greyed out rather than hidden, so it
stays possible to learn that they exist.

## Toolbar

![The toolbar](images/toolbar.png)

Left to right.

| Control | What it does |
|---|---|
| **Markers** / **Curves** | Switches the active tool. Also `1` and `2`. |
| **Mirror** | Mirrors placements across the character's centre line, and shows the symmetry plane in the viewport. On by default. Also `S`. |
| **Auto-place** | Fills in markers automatically: from the character's own skeleton when it has one, otherwise by measuring its shape. Disabled until a character is loaded. Never overwrites anything you placed. |
| **Shading** | How the character is drawn: Lit, Flat, Wire or Lit wire. See below. |
| **Show** | What is drawn: the character, markers, curves, the skeleton, the ground grid, and whether markers show through the body. The button turns amber and counts what is hidden, so nothing can be invisible without the interface saying so. |
| **Smooth** | Catmull-Clark preview level, 0 to 3. Display only: it never moves a marker you have placed. See below. |
| **Undo** / **Redo** | Steps the document history. The tooltip names the step, for example *Undo Place Chest*. |
| **Frame** | Frames the whole character. Also `A`. |

Saving, loading and exporting live in the **File** menu.

### Smoothing

Riser opens at level 0, showing the character exactly as the file describes it.
Smoothing is something you turn on, not something applied to your asset before
you have seen it. Level 0 is also the surface your markers are really written
against.

Each level you visit is kept, so moving the slider back to one you have already
used is instant.

If a level is too heavy for the character, Riser shows the highest one it can
and says so in the status bar, naming the face count. A very dense character
may be held at level 1 or 0 - that is the mesh being already detailed enough,
not a failure.

### Shading

Four ways to draw the character. Each answers a question the others cannot.

| Mode | What it is for |
|---|---|
| **Lit** | The character as its own materials describe it. The default. |
| **Flat** | Faceted shading, so every polygon's own plane is visible. Smooth shading hides topology. Most useful at Subdiv 0, since a subdivided surface has facets too small to see. |
| **Wire** | Edges only, seen through. The clearest way to judge whether a guide meant for a joint centre is really inside the limb rather than stuck to the near side of it. |
| **Lit wire** | Lit surface with its edges drawn over, for placing on a dense mesh where the silhouette alone does not show where an edge loop runs. |

Shading is display only. It never moves a guide, and you can place and drag
markers in any mode, including through an invisible surface in **Wire**.

## Markers panel

![The markers panel](images/checklist.png)

The left panel lists everything the current template asks for, grouped by body
part. It follows the active tool: markers while the marker tool is active,
curves while the curve tool is.

### Step-by-step

By default the panel opens with a card at the top showing **one** marker to
place, with the hint for it and where it goes. Place it and the card advances;
**Skip** moves on without placing.

Turn it off with the **x** on the card, or from **View › Step-by-step
guidance**, and the panel becomes the list alone. The choice is remembered.

### Finding things

A template can ask for forty markers, so the panel has a search box - `Ctrl+F`
focuses it - and four filters:

| Filter | Shows |
|---|---|
| **All** | Everything the template defines. |
| **Left** | Only what is still unplaced. |
| **Suggested** | Only what Riser placed for you, and you have not confirmed. |
| **Mine** | Only what you placed or adjusted. |

Groups fold away, and each carries a ring showing how much of it is done. A
search temporarily opens every group, so what matched is never hidden inside a
folded one.

### Right-click

Right-clicking a row offers: place it next, focus it in the viewport, confirm
it if Riser guessed it, and clear it. Right-clicking the viewport offers
framing, automatic placement, shading and visibility.

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
| **Reference** | The asset path written into the exported layer, and editable. Defaults to a relative path beside the layer, which resolves when the two files sit in one directory. Point it at your pipeline path if the asset lives elsewhere. |
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
