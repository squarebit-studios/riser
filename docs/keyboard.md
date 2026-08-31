# Keyboard and mouse

Every shortcut Riser responds to.

## Global shortcuts

These work anywhere in the window, except while you are typing in a text field.

| Key | Action |
|---|---|
| `1` | Marker tool |
| `2` | Curve tool |
| `F` | Focus the selection. Falls back to framing the character when nothing is selected. |
| `A` | Frame the whole character |
| `S` | Toggle symmetry |
| `X` | Toggle x-ray |
| `G` | Toggle the ground grid |
| `Ctrl`+`Z` | Undo |
| `Ctrl`+`Shift`+`Z` | Redo |
| `Ctrl`+`Y` | Redo |
| `Ctrl`+`S` | Save the document |
| `Ctrl`+`N` | New document, keeping the loaded character |
| `Ctrl`+`F` | Search the markers panel, opening it if it is collapsed |

On macOS, `Cmd` works in place of `Ctrl`.

## Tool shortcuts

These belong to the active tool and only reach it while the viewport has
keyboard focus. Clicking in the viewport gives it focus.

### Marker tool

| Key | Action |
|---|---|
| `Delete` or `Backspace` | Remove the selected guide |

### Curve tool

| Key | Action |
|---|---|
| `Delete` or `Backspace` | Remove the selected control vertex |
| `C` | Close the active curve into a loop, or open it again |
| `Escape` or `Enter` | Finish: deselect the current control vertex |

## Mouse

### Camera

| Gesture | Action |
|---|---|
| Left drag | Orbit |
| Right drag | Pan |
| Right click | Open the viewport menu: framing, automatic placement, shading, visibility |
| Wheel | Zoom |

A press and release without moving is a **click**, not a drag. The threshold is
four pixels, which is what lets the left button both orbit the camera and place
a marker without a modifier.

### Marker tool

| Gesture | Action |
|---|---|
| Click the mesh | Place the active guide there, then advance the checklist |
| Click a marker | Select it, and make it the active guide |
| Drag a marker | Slide it across the surface, re-binding as it goes |
| `Alt` + drag a marker | Lift it along its normal, into or out of the volume. Down goes deeper in. |

Dragging a marker keeps whatever depth it already had, so sliding a joint centre
along the arm does not pull it back out to the skin.

### Curve tool

| Gesture | Action |
|---|---|
| Click the mesh | Add a control vertex to the active curve, creating the curve on the first click |
| Click a control vertex | Select it |
| Drag a control vertex | Slide it across the surface, re-binding as it goes |

New control vertices are inserted where they fit along the curve rather than
always at the end. Tracing a jawline, you can work outwards from the chin in
both directions and the curve will not zig-zag back and forth.

## Notes

- Dragging a marker or a control vertex stands the camera down for the whole
  gesture, so the view will not tumble underneath you.
- Dragging off the mesh holds the last good position rather than snapping the
  marker away.
- The right button does not open a context menu over the viewport.
