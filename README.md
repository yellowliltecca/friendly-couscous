# BIZFINDER

BIZFINDER is a map-based business prospecting and lightweight CRM app.

## Deploy the complete app (frontend + API) for free

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://dashboard.render.com/blueprint/new?repo=https://github.com/yellowliltecca/friendly-couscous)

1. Open the deploy link and sign in to Render.
2. Connect GitHub and grant Render access to `yellowliltecca/friendly-couscous`.
3. Review the `bizfinder` Web Service and choose the Free plan.
4. Click **Apply** to deploy.
5. When the service status becomes **Live**, open its `onrender.com` URL.
6. Check `https://YOUR-RENDER-URL/api/health`. It should return `ok: true` and version `1.2.0`.

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
