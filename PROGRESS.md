# Progress, agent/hud

Interface work on the sidebar, the overlay, the menus and the end report. Newest first.

- End report: chart marks are tags naming the age (Med, Gun, Ind), the timeline's hover gives each side's age,
  the summary shows the age reached, and Economy has an ages-reached table in place of Tech II and III.
  Setup: theatre and starting age moved under the players so the sheet fits, with a line on what the age
  brings. Next: sidebar card states and tooltips.
- Age-up moment: a card in the readout strip's gap names the new age, says what it brings and shows up to six
  of its new forms, unrolls from its middle, holds four seconds and lifts away. The sidebar's cards an age
  brings are drawn in one after another and marked new. The voice names the age. Next: report and setup.
- Zoomed-out overlay: tags come in past dist 98 (no faint plates at the play distance 92), a side's units close
  together share one plate counting each kind, pictures follow the unit's form (horsemen, spears, bows, carts,
  siege engines, elephants, walkers), enemy plates have pointed ends, and in ink they are paper washed in the
  side's colour. Building marks follow the age (STBL, SMLT, WTCH) and skip any that would cover another. Towns
  are named with a pennant. The stats row drops the dead Lvl cell so the age fits. Next: age-up card.
- Drew all 46 older and future forms in axo.js after their models, with horses, riders, carts, siege engines,
  hover pads and walkers, and wood, hide and light washes in all three palettes. Pictures are drawn once per
  palette. Study in review-hud/axo.html. Next: the zoomed-out overlay, then the age-up card.
- Added axo.js helpers for the older and future forms: rods, balls, spoked wheels, ore lumps, a wagon's
  canvas, pennants, hover pads and depth groups. Next: the 46 forms' drawings, then the zoomed-out overlay.
