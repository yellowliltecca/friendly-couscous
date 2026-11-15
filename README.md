# BIZFINDER

BIZFINDER is a map-based business prospecting and lightweight CRM app.

## Deploy the complete app (frontend + API) for free

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://dashboard.render.com/blueprint/new?repo=https://github.com/yellowliltecca/friendly-couscous)

1. Open the deploy link and sign in to Render.
2. Connect GitHub and grant Render access to `yellowliltecca/friendly-couscous`.
3. Review the `bizfinder` Web Service and choose the Free plan.
4. Click **Apply** to deploy.
5. When the service status becomes **Live**, open its `onrender.com` URL.
6. Check `https://YOUR-RENDER-URL/api/health`. It should return `ok: true` and version `2.2.0`.

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

## Contacts and business details

The business card displays all supplied OSM phone numbers and emails, validated
Telegram/WhatsApp/VK and other social links, hours, description, brand/operator,
accessibility and service tags, distance from the search center, and the OSM
source link. Missing values are not inferred. Network-wide social links are
identified as potentially shared by branches. Categories are shown in Russian.

OpenStreetMap does not supply review text or consumer ratings. Without a paid
external API, the app offers clearly labeled searches in Yandex Maps, 2GIS and
Google Maps using the business name and address. These are search shortcuts,
not verified branch matches or imported reviews. Rating filters are disabled
when the current result set has no actual ratings. Demo ratings remain labeled.

## Search area

Drag the center marker to move the search, or drag the boundary marker to resize
the circle. Radius can also be changed with the slider, numeric input or +/−
buttons (1–50 km). Marker arrow keys provide a keyboard alternative. The map
previews the circle while dragging; one debounced search runs after release.
Increasing the radius requests fresh results rather than filtering the old
response. Area controls are disabled during a search. On failure the previous
results, center and radius are restored. Use “Вернуть центр к городу” to return
to the last geocoded city without resetting the radius.

Business cards keep unsaved note drafts when rerendering or switching cards.
The CSV export also includes contact links, hours, description and review search.
