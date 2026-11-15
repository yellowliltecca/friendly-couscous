# BIZFINDER

BIZFINDER is a map-based business prospecting and lightweight CRM app.

## Important: GitHub Pages is static hosting

GitHub Pages serves HTML/CSS/JavaScript only. It does not run the Node.js API in `server.js`. The business search API must run as a web service.

## Deploy the complete app (frontend + API) to Render

This repository includes `render.yaml` for a free Render Web Service.

1. Open [Render Blueprint](https://render.com/deploy).
2. Connect GitHub if asked and select `yellowliltecca/friendly-couscous`.
3. Review the service named `bizfinder` and choose the **Free** plan.
4. Click **Apply** / **Deploy**.
5. Wait for the first deployment to finish. A free service may take about a minute to wake after inactivity.
6. Open the service's `onrender.com` URL. Do not use the GitHub Pages URL for live search.
7. Check `https://YOUR-RENDER-URL/api/health`; it should return `ok: true` and version `1.2.0`.

The same Render service serves both the frontend and `/api/search`, so browser requests stay same-origin and do not depend on public Overpass CORS support.

## Local Windows run

From the project folder:

```powershell
npm.cmd start
```

Then open http://localhost:8787.

## Data limitations

Search results come from OpenStreetMap / Overpass. Coverage varies by place. Phone, email, website, rating and review counts are not guaranteed to exist in OSM. This is not Yandex Maps data.
