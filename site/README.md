# Mapmaker's War, the site

A real-time strategy game in three.js. Play a skirmish against computers, or
open a game room that others join from the list. The host picks the map, the terrain and how many computers play
and how hard, and the room plays out once everyone is ready.

- `public/index.html` is the game, built from the game's own folder by `site.sh`.
- `server/index.js` is a Cloudflare Worker. Each game room is a Durable Object that holds its lobby, then steps
  the game and sends each step's commands to every player. A Directory object lists the rooms.
  `server/rules.js` and `server/ai.js` are the same rules and commander the page runs, so every copy of a game
  stays the same.
- `wrangler.jsonc` deploys this as the worker `mapmakers-war`, answering at mapmakerswar.com and www.mapmakerswar.com.
- `redirect/` is the worker that served the game as Dead Ground, at dead-ground.nathan-05a.workers.dev. It now sends
  every request on to mapmakerswar.com.

Run locally with `npx wrangler dev`, deploy with `npx wrangler deploy`.

x.com/nmnvzr · Opus 5.5
