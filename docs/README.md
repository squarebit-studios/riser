# Riser documentation

Riser is a browser tool for setting up 3D characters. You load a character,
work through a checklist of named guide markers and curves by clicking directly
on the mesh, and export a USD layer that describes where everything sits.

Riser never modifies the character you load. What you author is a separate
layer that *references* the asset and adds your guides and curves beside it.

## Start here

| | |
|---|---|
| [Getting started](getting-started.md) | Install, run, place a marker, draw a curve, export. About five minutes. |
| [Concepts](concepts.md) | Templates, guides, curves, surface bindings, symmetry, subdivision. The ideas the rest depends on. |
| [The interface](interface.md) | A tour of the toolbar, checklist, viewport, inspector and status bar. |
| [Keyboard and mouse](keyboard.md) | Every shortcut, and what the mouse does. |
| [Templates](templates.md) | What the biped, quadruped and face templates ask for, and where each guide goes. |
| [FAQ and troubleshooting](faq.md) | My file will not load, my markers look wrong, what do I do with the .usda. |

## In one picture

![The Riser window with a biped loaded and guides placed](images/overview.png)

From left to right: the checklist of what to place, the viewport you click in,
and the inspector showing exactly what the selected guide is bound to.

## For developers

The root [README](../README.md) covers the architecture, the document format
and the reasoning behind both. The [worker README](../worker/README.md) covers
the server side that consumes what you export.
