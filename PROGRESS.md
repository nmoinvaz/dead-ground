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
- A squad that changes form at an age-up keeps its men, where it used to drop corpses when its count differed.

## Next

- Check the zoomed-out pass at 92, 150 and 200 in light and dark ink, then buildings, effects and battles far out.
- Motion: gallop and walk cycles, melee swings, catapult and trebuchet throws, cannon recoil.
- A scrum in melee, and a local sketch effect at an age-up.
