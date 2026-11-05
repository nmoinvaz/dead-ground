#!/bin/sh
# Builds the site: the page into site/public, and the rules, the commander and the server into site/server.
# Then `npx wrangler dev` in site/ runs it locally, and `npx wrangler deploy` puts it up.
set -e
cd "$(dirname "$0")"
~/Source/film-studio/.venv/bin/python ~/Source/film-studio/player/build.py game.json --out site/public/index.html
cp rules.js ai.js site/server/
cp server.js site/server/index.js
