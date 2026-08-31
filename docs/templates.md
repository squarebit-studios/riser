# Templates

A template is the list of guides and curves Riser asks you to place. Choose one
from the toolbar. Three ship with the app.

| Template | For | Guides | Curves |
|---|---|---|---|
| **Biped** | Two-legged characters | 49, of which 32 are required | 11, of which 9 are required |
| **Quadruped** | Four-legged characters | 40, of which 34 are required | 5, of which 1 is required |
| **Face only** | Busts and headshots, no body | 20, of which 16 are required | 10, of which 6 are required |

The progress bar counts required **guides** only. Optional entries are marked
**OPT** in the checklist, and curves are not counted at all.

Two conventions run through every template:

- **IN** marks an *interior* guide, one that belongs inside the volume rather
  than on the skin. Click on the surface to fix where along the body it sits,
  then alt-drag to set its depth. See
  [interior guides](concepts.md#interior-guides).
- **Left** and **right** are the character's own left and right, not yours.
  With symmetry on you only place one of each pair.

---

# Biped

*Two-legged character. Place the body guides first, then the face.*

## Spine and head

| Guide | Where it goes | |
|---|---|---|
| Root | On the ground between the feet. This is where the character stands. | IN |
| Pelvis | Centre of the hips, inside the body. | IN |
| Lower spine | Just above the pelvis, at the waist. | IN |
| Mid spine | Around the bottom of the ribcage. | IN |
| Chest | Top of the ribcage, between the shoulders. | IN |
| Neck | Base of the neck where it meets the shoulders. | IN |
| Head | Base of the skull, roughly level with the ears. | IN |
| Top of head | Crown of the skull. Sets the character's height. | |

Work down this group first. The spine chain is what everything else is measured
against, and *Top of head* is the one guide in it that belongs on the surface.

## Left and right arm

| Guide | Where it goes | |
|---|---|---|
| Clavicle | Inner end of the collarbone, near the throat. | IN |
| Shoulder | Centre of the shoulder joint, inside the deltoid. | IN |
| Elbow | Centre of the elbow joint. | IN |
| Wrist | Centre of the wrist, where the hand starts to bend. | IN |

All four are interior. Place them looking at the arm from the front, then orbit
to the side and alt-drag each one to the middle of the limb. A shoulder centre
in particular is deeper in than it looks from the front.

## Left and right hand

Every hand guide is optional. Place them if the character's hands need to
animate, and skip them for a background figure.

| Guide | Where it goes |
|---|---|
| Thumb base | The knuckle where the thumb leaves the palm. |
| Thumb tip | The end of the thumb. |
| Index base | The knuckle at the base of the index finger. |
| Index tip | The end of the index finger. |
| Pinky base | The knuckle at the base of the little finger. |
| Pinky tip | The end of the little finger. |

Thumb, index and pinky are enough to fix the span and the plane of the hand.
The remaining fingers are interpolated from them downstream.

## Left and right leg

| Guide | Where it goes | |
|---|---|---|
| Hip | Centre of the hip socket, inside the body. | IN |
| Knee | Centre of the knee joint. | IN |
| Ankle | Centre of the ankle joint. | IN |
| Toe base | Ball of the foot, where the toes bend. | |
| Toe tip | The end of the longest toe. | OPT |

The hip socket is further in and lower than the top of the pelvis. Put it where
the femur head would be, not at the waistline.

## Face

| Guide | Where it goes | |
|---|---|---|
| Jaw pivot | Just in front of the ear, where the jaw hinges. | IN |
| Chin | The point of the chin. | |
| Left / right eye | Centre of the eyeball, inside the socket. | IN |
| Nose tip | The tip of the nose. | |
| Nose bridge | Between the eyes, where the bridge starts. | OPT |
| Mouth centre | Between the lips, at the centre of the mouth. | |
| Left / right mouth corner | Where the lips meet at each side. | |
| Left / right ear | The ear canal, or the centre of the ear. | OPT |

The eye guides are eyeball centres, not surface points. Place them on the eye
and alt-drag back until each one sits at the middle of the sphere.

## Curves

| Curve | What to trace | Suggested points | |
|---|---|---|---|
| Left / right brow | Trace the brow ridge from the inner to the outer end. | 5 | |
| Left / right upper lid | The upper lid opening, inner corner to outer. | 5 | |
| Left / right lower lid | The lower lid opening, inner corner to outer. | 5 | |
| Upper lip | Corner to corner across the top lip. | 7 | |
| Lower lip | Corner to corner across the bottom lip. | 7 | |
| Jawline | Ear to chin to ear, following the edge of the jaw. | 9 | |
| Hairline | Where the hair meets the forehead, temple to temple. | 7 | OPT |
| Spine curve | Down the back from the base of the neck to the tailbone. | 6 | OPT |

---

# Quadruped

*Four-legged character. Front legs carry a scapula the way a horse or dog does,
not a human clavicle.*

The naming follows animal anatomy, which does not line up with human intuition.
The front leg's visible "knee" is a wrist, and the back leg's backward-bending
joint is an ankle. The hints in the checklist say so where it matters.

Choose this template **before** loading the character. Automatic placement uses
it to decide how to measure - along the body's length rather than its height -
so a horse loaded under the biped template fills nothing, and the same horse
under this one fills the whole checklist. See
[Provenance](concepts.md#provenance-who-placed-this).

## Spine and head

| Guide | Where it goes | |
|---|---|---|
| Root | On the ground beneath the centre of the body. | IN |
| Pelvis | Centre of the hips, inside the body. | IN |
| Lower spine | Loin, just ahead of the pelvis. | IN |
| Mid spine | Middle of the back. | IN |
| Chest | Withers, between the shoulder blades. | IN |
| Neck base | Where the neck leaves the body. | IN |
| Mid neck | Halfway along the neck. | IN, OPT |
| Head | Where the skull meets the neck. | IN |

## Tail

All three are optional. Skip them for an animal without a tail.

| Guide | Where it goes | |
|---|---|---|
| Tail base | Where the tail leaves the body. | IN, OPT |
| Mid tail | Halfway along the tail. | IN, OPT |
| Tail tip | The end of the tail. | OPT |

## Front left and front right leg

| Guide | Where it goes | |
|---|---|---|
| Scapula | Top of the shoulder blade. | IN |
| Front shoulder | The shoulder joint, at the bottom of the scapula. | IN |
| Front elbow | The elbow, close in against the ribcage. | IN |
| Carpus | The front knee, anatomically a wrist. | IN |
| Front fetlock | The joint above the foot. | IN |
| Front foot | Where the foot meets the ground. | |

## Back left and back right leg

| Guide | Where it goes | |
|---|---|---|
| Hip | Centre of the hip socket, inside the body. | IN |
| Stifle | The true knee, high on the back leg. | IN |
| Hock | The backward-bending joint, anatomically an ankle. | IN |
| Back fetlock | The joint above the foot. | IN |
| Back foot | Where the foot meets the ground. | |

## Head and face

| Guide | Where it goes | |
|---|---|---|
| Jaw pivot | Where the jaw hinges, below and in front of the ear. | IN |
| Muzzle | The front of the muzzle, ahead of the eyes. | |
| Nose tip | The end of the nose. | |
| Left / right eye | Centre of the eyeball, inside the socket. | IN |
| Left / right ear | The base of the ear. | OPT |

## Curves

| Curve | What to trace | Suggested points | |
|---|---|---|---|
| Spine curve | Poll to tail along the topline. | 8 | |
| Belly line | Along the underside, chest to groin. | 6 | OPT |
| Upper lip | Across the top lip. | 5 | OPT |
| Left / right eye ring | A closed loop around the eye opening. | 8 | closed, OPT |

---

# Face only

*Head and face detail on its own, for busts and headshots. No body guides.*

Use this for a head that is not attached to a body, or when only the face needs
setting up. It asks for more facial detail than the biped template does.

## Skull

| Guide | Where it goes | |
|---|---|---|
| Head centre | Middle of the skull, roughly level with the ears. | IN |
| Top of head | Crown of the skull. | |
| Neck | Base of the neck. | IN |

## Eyes

| Guide | Where it goes | |
|---|---|---|
| Left / right eye centre | Centre of the eyeball, inside the socket. | IN |
| Left / right inner corner | Where the lids meet nearest the nose. | |
| Left / right outer corner | Where the lids meet nearest the temple. | |

The corners are surface points on the lid opening. The centre is inside the
socket, so place it and alt-drag back to the middle of the eyeball.

## Mouth and jaw

| Guide | Where it goes | |
|---|---|---|
| Jaw pivot | Just in front of the ear, where the jaw hinges. | IN |
| Chin | The point of the chin. | |
| Mouth centre | Between the lips, at the centre of the mouth. | |
| Left / right mouth corner | Where the lips meet at each side. | |

## Nose and ears

| Guide | Where it goes | |
|---|---|---|
| Nose tip | The tip of the nose. | |
| Nose bridge | Between the eyes, where the bridge starts. | |
| Left / right nostril | The outer edge of each nostril. | OPT |
| Left / right ear | The ear canal, or the centre of the ear. | OPT |

## Curves

| Curve | What to trace | Suggested points | |
|---|---|---|---|
| Left / right brow | Along the brow, inner end to outer. | 5 | |
| Left / right eye opening | All the way around the lid opening. | 8 | closed |
| Outer lip | All the way around the mouth. | 12 | closed |
| Inner lip | Around the inside edge of the lips. | 12 | closed, OPT |
| Jawline | Along the edge of the jaw. | 9 | |
| Left / right smile line | The nasolabial fold, from beside the nose down past the mouth corner. | 5 | OPT |
| Hairline | Where the hair meets the forehead, temple to temple. | 7 | OPT |

Curves marked *closed* are loops, and they start closed: the last point joins
back to the first as you trace. Press `C`, or use **Open** in the inspector, if
you need to break the loop.
