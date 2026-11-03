# Dead Ground

A real-time strategy game in three.js after Red Alert and Rise of Nations, with a shared world of eight
slots: anyone who opens the page and joins takes a slot, and computers hold the rest.

- `public/index.html` is the game, built from the game's own folder by `site.sh`.
- `server/index.js` is a Cloudflare Worker with one Durable Object that steps the world and sends each
  step's commands to every player. `server/rules.js` and `server/ai.js` are the same rules and commander
  the page runs, so every copy of the world stays the same.

Run locally with `npx wrangler dev`, deploy with `npx wrangler deploy`.

x.com/nmnvzr · Opus 5.5
