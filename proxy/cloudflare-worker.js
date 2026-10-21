// Moxfield import proxy as a Cloudflare Worker (free plan is plenty).
// Answers GET /moxfield/decks/{id} with the deck JSON plus CORS headers,
// the same contract as moxfield-proxy.py.
//
// Deploy: dash.cloudflare.com -> Workers & Pages -> Create -> "Hello World"
// worker -> Edit code -> paste this file -> Deploy. Put the worker's
// https://<name>.<you>.workers.dev URL in the app's Settings.
//
// Moxfield sits behind Cloudflare too and may still refuse some requests;
// if imports fail, run moxfield-proxy.py instead or paste the deck's export.

const MOXFIELD_API = "https://api.moxfield.com/v2/decks/all/";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Accept, Content-Type",
};

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    const match = new URL(request.url).pathname.match(/^\/moxfield\/decks\/([A-Za-z0-9_-]+)\/?$/);
    if (!match) return json({ error: "Not found. Use /moxfield/decks/{id}" }, 404);
    try {
      const res = await fetch(MOXFIELD_API + match[1], {
        headers: { Accept: "application/json", "User-Agent": "CommanderTracker/1.0 (playgroup life tracker)" },
      });
      return new Response(res.body, { status: res.status, headers: { ...CORS, "Content-Type": "application/json" } });
    } catch (e) {
      return json({ error: String(e) }, 502);
    }
  },
};

function json(body, status) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}
