# Units without pink, in pen and ink

Branch `agent/units`. Studies in `review-units/` (git-ignored).

## Sources of pink found in the code

1. Slot 6 was pink everywhere: `SLOT_COLORS[6]` `0xe0459a` (world.js), `SLOT_CSS[6]` `#ff7ac0` and
   `SLOT_PLATE[6]` `#c83c8a` (hud.js, report.js, game.js).
2. Ink look, dark paper, the default units (`look.units` 1): every unit line was `tInk = mix(DINK, hue, 0.55)`, a
   pastel of the side's hue. Red became `#f56d60`, a salmon pink, and slot 6 `#f5709a`.
3. Ink look, dark paper: `sideInk = hue * 0.45 + 0.5`, the ink of a unit's hatching. Red became `(0.95, 0.5, 0.5)`.
4. Ink look, light paper, far zoom (`zU`): a unit's shade was a flat 40 % tint of its side's ink, salmon for red.
5. Ink look, light paper, close: fine hatching in a red ink mixes to pink by eye, and its soft edges are pink.
6. Ink look, dark paper: the swell of a unit's outline lay past the outline's ink taps, took the land's light sepia
   ink and mixed it with red into a salmon rim.
7. Ink look, light paper, at dawn and dusk: the cool violet shade wash on a unit's cream body turns rose under the
   hour's rose tint.
8. Not pink but related: the side's ink came from its hue alone, taken from the linear colour, so red, orange and
   brown drew in nearly one ink (OKLab distance 3.5 orange to brown, 4.3 red to orange on light paper).
9. HUD tags and town marks in ink: `washOf(team)` mixed `SLOT_CSS` 55/45 with paper, `#fdb19b` for red.
10. Sidebar axo pictures, light paper: `wash(SLOT_CSS[team])` gave a red player `#fcbda9` markings.
11. `SLOT_CSS[1]` `#ff7a60` was itself a salmon.
12. Left alone and noted: a townsfolk shirt `0xd8a0a0` (world.js `SHIRTS`), the HUD's attack markers `#ff5a40`,
    the overlay's dark-scheme filter that turns any deep red mark (brackets, rings) light, the hour's rose tint,
    which turns all light paper pink at the first instant of dawn and at dusk, and the charcoal look's pastels.

Skin tones (`0xc99a78` in models.js, `#e6c8a6` in axo.js) are hue 24 to 32 degrees, orange-tan, not pink.

## Done

- `SLOT_INKS` in world.js: a deep ink for light paper and a bright one for dark, for each of the eight slots, and
  slot 6 is citron. Exported with `SLOT_COLORS` on `World`.
- looks/ink.js finds each unit's side from the anchor's hue and colourfulness and draws it in that side's ink.
  Far shade on light paper is solid ink, close hatching on light paper is the ink darkened two fifths toward black,
  the outline's swell keeps the side's ink, and a unit's shade wash is slate.
- `SLOT_CSS` and `SLOT_PLATE` updated in hud.js, report.js and game.js. axo.js stops a marking's wash before it
  turns pink, and the HUD's tag wash shares it on light paper.
- Red pushed back toward scarlet and orange to amber after review. Red to orange is 16.0 on light paper, 12.3 on
  dark. The smallest pair is 10.6 on light (green to citron) and 11.2 on dark (blue to violet), up from 3.5 and 4.5.
- Counts, pairs, the swatch, the Daylight check and the page-error check are done.

## Now

- Writing the final report.

## Left

- Nothing on the plan. Open questions are in the report.
