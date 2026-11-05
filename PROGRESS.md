# Units without pink, in pen and ink

Branch `agent/units`. Studies in `review-units/` (git-ignored).

## Sources of pink found in the code

1. Slot 6 is pink everywhere: `SLOT_COLORS[6]` `0xe0459a` (world.js), `SLOT_CSS[6]` `#ff7ac0` and
   `SLOT_PLATE[6]` `#c83c8a` (hud.js, report.js, game.js).
2. Ink look, dark paper, the default units (`look.units` 1): every unit line is `tInk = mix(DINK, hue, 0.55)`, a
   pastel of the side's hue. Red becomes about `(0.96, 0.43, 0.38)`, a salmon pink, and slot 6 about
   `(0.96, 0.44, 0.60)`, a plain pink.
3. Ink look, dark paper: `sideInk = hue * 0.45 + 0.5`, the ink of a unit's hatching and faint lines. Red becomes
   `(0.95, 0.5, 0.5)`, pink.
4. Ink look, light paper, far zoom (`zU`): a unit's shade is a flat 40 % tint of its side's ink on cream paper. For red
   that is about `(0.79, 0.57, 0.52)`, a salmon pink.
5. Ink look, light paper, close: the soft edges of dark red lines on cream paper pass through pink.
6. Not pink but related: the anchor pass stores the side's hue from the linear colour, so red, orange and brown sides
   all draw in nearly the same red-orange ink in ink. Brown and orange are about 3 degrees apart.
7. HUD tags in ink: `washOf(team)` mixes `SLOT_CSS` 55/45 with paper, so the red side's tags are `#fdb19b`, peach-pink.
8. Sidebar axo pictures, light paper: `wash(SLOT_CSS[team])` gives a red player `#fcbda9` markings, pink.
9. `SLOT_CSS[1]` `#ff7a60` is itself a salmon, used for chips, report bars and the non-ink minimap.
10. Outside the units: a townsfolk shirt `0xd8a0a0` in `SHIRTS` (world.js), and the HUD's attack markers
    `#ff5a40`. Neither is a side colour. Left alone, noted.

Skin tones (`0xc99a78` in models.js, `#e6c8a6` in axo.js) are hue 24 to 32 degrees, orange-tan, not pink.

## Done

- Read the unit colour path through models.js, world.js (paint, mask, anchor), looks/ink.js, axo.js and the HUD.
- Listed the sources above. Saved the baseline build as `review-units/before.html`.

## Baseline, measured

`review-units/tools/pink.js` stands every form of an age in two rows, the red side (slot 1) above slot 6, on the
eight-seat map with no fog, close (distance 45) and far (180, all 62 forms, with and without the HUD tags).
`review-units/tools/pinkcount.py` counts pink pixels in each unit's screen circle. Baseline frames are in
`review-units/base/`. On dark paper the red side reads salmon and slot 6 pink at a glance.

## Now

- Designing eight side inks, one for light paper and one for dark, and a colour for slot 6.

## Left

- The axo pictures' baseline count.
- New slot colours and per-side inks, then the after counts, pairs, swatch and page-error check.
