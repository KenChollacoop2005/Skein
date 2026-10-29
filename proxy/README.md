# Optional live lookup proxy

Skein ships with a saved catalog, so this proxy is optional. It lets the app look up items that are not in the catalog. It holds the Kroger secret on Cloudflare, so the secret never reaches the browser. It is not deployed by default.

## Deploy

1. Install Wrangler: `npm install -g wrangler`, then `wrangler login`.
2. From this folder, create the worker: `wrangler init skein-proxy --no-git` and replace its `src/index.js` with `worker.js`, or run `wrangler deploy worker.js --name skein-proxy --compatibility-date 2025-01-01`.
3. Add the secrets (Wrangler asks for each value):
   - `wrangler secret put KROGER_CLIENT_ID`
   - `wrangler secret put KROGER_CLIENT_SECRET`
4. Add plain variables in the Cloudflare dashboard (Workers, skein-proxy, Settings, Variables):
   - `LOCATION_ID`: the store's locationId from `node tools/kroger.mjs locations`
   - `ALLOWED_ORIGIN`: `https://kenchollacoop2005.github.io`
5. Copy the worker URL into Skein, Settings, Live lookup URL.

The app calls `<url>?term=peanut%20butter` and expects `{ "items": [...] }` in the same format as `data/catalog.json`.
