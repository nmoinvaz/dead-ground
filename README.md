# Mapmaker's War

A real-time strategy game in three.js, after Red Alert and Rise of Nations, drawn in pen and ink. Every side
advances through six ages, Ancient to Future, and each of its units takes a new form in each age: spearmen become
pikemen, musketeers, riflemen, rifle squads and exo troopers. Play a skirmish against computers or open a game room
for others to join at https://mapmakerswar.com.

## Layout

```
rules.js       the world as deterministic rules, with no drawing: maps, units, ages, combat, economy, the record
ai.js          the computer commander, Recruit, Regular and Veteran
models.js      every unit and building built from primitives
world.js       the 3D picture: terrain, units, effects, weather, scenery
looks.js       the registry of looks, with looks/ink.js (pen and ink), the game's one look
hud.js         the sidebar, minimap, overlay, and every way of giving an order
report.js      the end-of-game report, after Age of Empires
axo.js         the sidebar's unit pictures as axonometric line drawings
game.js        the menus, skirmish and game rooms, saving, sound
page.html      the page the game is built into
server.js      the game rooms' server, a Cloudflare Worker with Durable Objects
sfx.py         the synthesized sounds, into sfx/
site/          the built site that is deployed, made by site.sh
```

## Building

The page is built with film-studio's `player/build.py`:

```sh
~/Source/film-studio/.venv/bin/python ~/Source/film-studio/player/build.py game.json          # dist/index.html
./site.sh                                                                                      # site/
cd site && npx wrangler deploy
```

## Checks

```sh
node check.js --games 6            # computers play each other headless and report how the games went
node lobbycheck.js URL [outdir]    # two players through a game room against a running server
```
