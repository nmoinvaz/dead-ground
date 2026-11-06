#!/bin/sh
# Builds the site: the page into site/public, and the rules, the commander and the server into site/server.
# Then `npx wrangler dev` in site/ runs it locally, and `npx wrangler deploy` puts it up.
set -e
cd "$(dirname "$0")"
~/Source/film-studio/.venv/bin/python ~/Source/film-studio/player/build.py game.json --out site/public/index.html
# The settings panel names the build: the source commit, marked + when the folder holds unsaved changes, and when.
STAMP="$(git rev-parse --short HEAD)$(git diff --quiet -- . ':!site' || echo +) $(date '+%Y-%m-%d %H:%M')"
sed -i '' "s/Build __BUILD__/Build $STAMP/" site/public/index.html
# The build the site now serves, which open pages compare with their own to offer a reload.
printf '{"build":"%s"}\n' "$STAMP" > site/public/version.json
cp rules.js ai.js site/server/
cp server.js site/server/index.js
