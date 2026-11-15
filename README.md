# BIZFINDER

BIZFINDER is a map-based business prospecting and lightweight CRM app.

## Deploy the complete app (frontend + API) for free

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://dashboard.render.com/blueprint/new?repo=https://github.com/yellowliltecca/friendly-couscous)

1. Open the deploy link and sign in to Render.
2. Connect GitHub and grant Render access to `yellowliltecca/friendly-couscous`.
3. Review the `bizfinder` Web Service and choose the Free plan.
4. Click **Apply** to deploy.
5. When the service status becomes **Live**, open its `onrender.com` URL.
6. Check `https://YOUR-RENDER-URL/api/health`. It should return `ok: true` and version `2.1.0`.

**Use the Render URL for the live app, not the GitHub Pages URL.** GitHub Pages serves static files and cannot run the Node.js API in `server.js`. Render serves both the frontend and API from one origin, avoiding browser-to-Overpass CORS requests.

A free web service can sleep when idle and may take a short time to wake. Public Overpass servers can still rate-limit or be unavailable; the app reports this as a source error rather than claiming that no businesses exist.

## Local Windows run

From the project folder:

```powershell
npm.cmd start
```

Then open http://localhost:8787.

## Data limitations

Search results come from OpenStreetMap / Overpass. Coverage varies by place. Phone, email, website, rating and review counts are not guaranteed to exist in OSM. This is not Yandex Maps data.

## Search reliability

Only global Overpass replicas are used. The regional `ovp.dresel.systems` extract
returns empty results for Engels even when the global replicas have businesses.
Search sends POST queries, allows 28 seconds per attempt (including transport),
retries a transient failure once within a 52-second total deadline, and returns
the first nonempty response without waiting for broken mirrors.

Overpass HTTP 200 responses containing `remark` are treated as errors. Empty
results require confirmation from two global replicas and are cached for only
30 seconds; successful nonempty results retain the normal ten-minute cache.
Failures return HTTP 503, are not cached, and preserve the previous results in
the browser.

`SEARCH_UPSTREAM_TIMEOUT_MS` controls the search attempt budget (default 28000);
`SEARCH_TOTAL_TIMEOUT_MS` controls the overall deadline (default 52000). Existing
Render services with an old `UPSTREAM_TIMEOUT_MS=14000` still get the new search
default without manually changing their environment. `/api/health` and
`/api/diagnostics` report the same release version.

Run regression checks with `npm test`.
