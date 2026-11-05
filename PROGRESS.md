# Battlefield look and feel, agent/field

## Done

- Zoomed out, first pass: contours generalise where they crowd (odd lines go first, index lines last), road
  hachures are sparser and pale as the view draws back, small units take a flat tint of their side's ink instead of
  hatching and keep their inner lines light, rocks are lumpy outcrops toned to take scribble shade, remembered ore
  sinks toward the dark paper, and squads stand in ranks.
- Buildings take a light wash of their own stuff in the ink pass (thatch, mud brick, stone, tile, slate, brick), so
  a base reads its age from far off. The mask pass carries a building's vertex colours at half strength for it.
- Ore rings are lighter, remembered ore is dashed lightly and sinks toward dark paper, and bridge decks have seams.
- Arrows fly as inked shafts, one from each man of a squad as a volley, and those that miss stick in the ground for
  a few seconds. Thrown stones tumble as stones with a short trail of the pen behind them in ink. Strokes of the pen
  (`addStroke`) are a general instanced mark for trails and sketches.
- Bridges read as bridges from far out: cutwater piers stand out on the water past both sides of the deck, the deck's
  rails and seams are inked firmly, its shadow is hatched on the water away from the sun, and its lane marks show only
  from the Industrial Age.
- Motion: horses walk, trot and gallop on two-part legs shared per coat (one mesh for all of a make), oxen and
  elephants walk, the mech and titan step, wooden wheels roll, a cannon runs back as it fires. Soldiers' arms are their
  own part: spears and pikes lunge, bows rise and draw, muskets kick and are lowered to load, grenades go overarm.
  Riders' lances thrust and sabres chop, an elephant gores. The catapult's arm (its tilt fixed) snaps up against the
  crossbar and is winched down, the trebuchet's weight drops and its arm whips over, and their stones leave from the
  arm as it comes up. Melee ranks press in and jostle. Sidebar pictures and wrecks draw the rigs at rest.
- Age-up: dust round each changed unit and building, and in ink a quick double loop of the pen in the side's colour
  round each unit and a sketched frame round each building, gone in about a second. Daylight shows a pale ring.
- A squad that changes form at an age-up keeps its men, where it used to drop corpses when its count differed.

- Wrecks are drawn at the units' own scale (they used to shrink by a fifth on death), models with moving parts lie
  at rest, and a fallen beast sinks on folded legs.

## Checked

Headless at 1440x900, device scale 2, pictures in `review-field/` (git-ignored): zoomed out at 92, 150 and 200 in
light and dark (`final-gp-*`, `v3-steppe-*`, `v1-gp-*` against `base-gp-*`), bridges (`br2-*`), arrows (`v4-*`),
rest poses (`m1-*`, `m2-*`), gallop, fight and men strips (`m4`, `m5`, `m7`, `m8`), the age-up (`m6-*`) and Daylight
(`m9-*`). A frame takes about the same as on the starting commit (26.0 against 25.0 ms median, headless).

## Still open

- On dark paper the material washes are faint, so a base's age reads less there than on light paper.
- Ore fields are lighter but still the busiest texture at 150 to 200; one nugget a cell when far out would calm them.
- From about 130 out the HUD's pictograms cover the units, so the 3D units carry the read only nearer than that.
- Not seen moving in a picture: the trebuchet's throw, the elephant's gore, the mech's and titan's steps. They share
  the code the catapult, the horses and the probes were checked with.
