// The game's old address, dead-ground.nathan-05a.workers.dev, sends every request on to mapmakerswar.com with its
// path and query. The old worker's room classes stay exported, and empty, so no migration deletes what it stored.
const HOME = 'https://mapmakerswar.com';
export default {
  fetch(req) {
    const u = new URL(req.url);
    return Response.redirect(HOME + u.pathname + u.search, 301);
  },
};
export class Room { fetch() { return new Response(`Moved to ${HOME}`, { status: 410 }); } }
export class Directory { fetch() { return new Response(`Moved to ${HOME}`, { status: 410 }); } }
