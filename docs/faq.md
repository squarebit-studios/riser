# FAQ and troubleshooting

- [My file will not load](#my-file-will-not-load)
- [Nothing happens when I click the character](#nothing-happens-when-i-click-the-character)
- [My markers look like they are floating](#my-markers-look-like-they-are-floating)
- [The marker did not land where I clicked](#the-marker-did-not-land-where-i-clicked)
- [The mirrored marker did not appear](#the-mirrored-marker-did-not-appear)
- [Delete does nothing](#delete-does-nothing)
- [Auto-place is greyed out](#auto-place-is-greyed-out)
- [The subdivision number turned amber](#the-subdivision-number-turned-amber)
- [I changed template and my guides vanished](#i-changed-template-and-my-guides-vanished)
- [I reloaded the page and lost everything](#i-reloaded-the-page-and-lost-everything)
- [My character is the wrong size](#my-character-is-the-wrong-size)
- [What do I do with the exported .usda](#what-do-i-do-with-the-exported-usda)

## My file will not load

**Check the extension.** Riser reads `.usd`, `.usda`, `.usdc`, `.usdz`, `.glb`,
`.gltf`, `.fbx` and `.obj`. Anything else is refused by name, and the message
lists what is supported.

**Check it is a character, not a document.** The **Upload** button and the drop
target take *characters*. A Riser document, the `.usda` you exported, goes in
through **Open** instead. They are both USD, so it is an easy mix-up.

**Check the error panel at the bottom of the viewport.** A load that fails part
way leaves the reason there, and it stays until you dismiss it.

**Prefer USD.** USD and glTF state their own units and up axis, so they arrive
correctly oriented and scaled. FBX and OBJ declare nothing reliable, so Riser
has to guess a scale from the size of the model.

## Nothing happens when I click the character

Three usual causes.

**No entry is active.** The status bar tells you: *Choose a guide from the list
to place it.* Click a row in the checklist first. The highlighted row is what
your click will place.

**Your click was a drag.** Move more than four pixels between pressing and
releasing and the gesture becomes a camera orbit, deliberately, so that one
button can do both. Click without moving.

**You clicked an existing marker.** Clicking a marker selects it rather than
placing a new one. Click bare mesh.

## My markers look like they are floating

**They may be inside the character on purpose.** Guides marked **IN** in the
checklist are interior: hips, shoulders, elbows and eyeballs belong inside the
volume, not on the skin. With **X-ray** on you see them through the surface,
which reads as floating until you orbit.

**Check the Subdiv level.** Markers are placed on the smooth preview surface,
which sits outside the raw mesh in convex places. Drop the slider to 0 and you
see the raw mesh, so markers placed against the smooth version now appear to
hover off it. Nothing has moved: put the level back and they sit correctly
again. See [the subdivision preview](concepts.md#the-subdivision-preview).

**Check the binding.** Select the marker and look at **Bound to** in the
inspector. If it says *nothing - free in space*, the marker really is loose,
and only its stored position exists. Drag it onto the mesh to bind it.

## The marker did not land where I clicked

For an interior guide, that is expected. Riser puts it slightly below the
surface on placement so you are adjusting depth rather than starting from
scratch. Alt-drag to set the depth you want.

## The mirrored marker did not appear

Riser will not invent a binding. To mirror a placement it reflects the point
across the character's centre line and then casts a ray at it to find real
geometry on the far side. When there is nothing there, it places only the side
you clicked and says so in the status bar.

The usual reasons:

- **The character is not symmetric**, or is posed with a limb across the body.
- **You clicked near the centre line**, where the reflected ray can miss.

Place the other side by hand. Selecting the partner guide in the checklist and
clicking is all it takes.

You may also notice a mirrored pair is not numerically identical. That is
correct: the mirror binds to a real triangle, and a mesh's triangulation is
rarely perfectly symmetric, so the two sides can differ by a millimetre or so.

## Delete does nothing

`Delete` and `Backspace` belong to the active tool, and tools only receive keys
while the viewport has keyboard focus. Click once in the viewport and try
again. You also need something selected: a marker for the marker tool, a
control vertex for the curve tool.

The inspector's **Remove** button works regardless of focus.

## Auto-place is greyed out

Auto-place reads the character's own rig, so it needs one. Check **Skeleton**
in the inspector's Character section. If it says `none`, there is nothing to
read and you place the guides by hand.

Of the bundled characters, only **Biped (rigged)** carries a skeleton.

## The subdivision number turned amber

The level you asked for was reduced because the mesh is dense enough that
refining it would stall the tab. A dense character does not need subdividing to
look smooth, so this costs you nothing. Bindings are unaffected either way.

## I changed template and my guides vanished

Changing template drops any guides and curves the new template does not define,
because it cannot show you a checklist entry that no longer exists. Going from
Biped to Face only keeps the face guides and discards the body.

`Ctrl`+`Z` undoes the switch and brings them back.

## I reloaded the page and lost everything

Riser holds your document in memory only. There is no autosave, and nothing is
kept between page loads.

Use **Export USD** before you close the tab, and **Open** to load the `.usda`
back in and carry on. The status bar shows **Unsaved changes** whenever there is
something unexported, and the **Export USD** button carries a bullet.

## My character is the wrong size

USD and glTF declare their units, so Riser trusts them. FBX and OBJ do not
declare anything reliable, so Riser guesses a scale from the model's size, and
the guess can be wrong.

Converting to USD before loading is the fix. Positions are stored in the
character's own space, so the scale it arrives at is the scale everything
downstream is expressed in.

## What do I do with the exported .usda

The file is an ordinary USD layer. It opens in `usdview` or any USD-aware
application, and it is what the server-side systems read.

Inside it:

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
            rel           riser:guide:bindPrim    = </Riser/Character/Geom/Body>
            int           riser:guide:faceIndex   = 12043
            float3        riser:guide:barycentric = (0.21, 0.34, 0.45)
            float3        riser:guide:offset      = (0, 0, 0)
        }
    }
}
```

- Guides are `Xform` prims under `/Riser/Guides`, one per guide, positioned by a
  translate and carrying their binding in `riser:` attributes.
- Curves are `BasisCurves` prims under `/Riser/Curves`, so any USD tool can draw
  them, with the same binding data as arrays.
- The character is **referenced**, not copied. Your asset is untouched.

**About that reference.** It points at wherever the character came from. If you
uploaded a file, it is that file's name, so keep the exported layer beside the
character and it resolves. If you loaded a bundled character, it points at the
path the app served it from, which will not resolve on your machine. Edit the
`references = @...@` line to point at your copy of the asset, or open the layer
in a tool that lets you repoint it.

The positions in the file are a hint. The authoritative values are what OpenUSD
computes by evaluating each binding against the geometry the reference actually
resolves to, which is what makes the layer survive a mesh change. See
[surface bindings](concepts.md#surface-bindings).
