# PumpSathi — Netlify edition

The same PumpSathi app, re-architected to run natively on **Netlify**:

- **Frontend** — static SPA in `public/` (served by Netlify's CDN).
- **API** — one Netlify Function (`netlify/functions/api.js`) running the Express
  app via `serverless-http`; the SPA's `/api/*` calls are rewritten to it.
- **Database** — **Netlify Blobs** (built in — *no external DB or account*). Each
  firm's collections and settings are stored as JSON blobs, fully isolated per firm.
- **WhatsApp alerts** — a **scheduled function** (`alerts-cron.js`) runs every
  15 min and sends the enabled alerts (send-times interpreted in IST).

Everything the Render version does — multi-firm, mobile-number login, per-firm
data, flexible dashboard range, Consolidated Report, WhatsApp preview/live — works
here too.

## Deploy (Git → Netlify, recommended)

1. Push this folder to a GitHub repo.
2. Netlify → **Add new site ▸ Import an existing project** → pick the repo.
   Netlify reads `netlify.toml` (publish `public`, functions `netlify/functions`).
3. **Site settings ▸ Environment variables** — add (from `.env.example`):
   `APP_NAME`, `JWT_SECRET` (a long random string), `OWNER_MOBILE`,
   `OWNER_PASSWORD`, `OWNER_FIRM_NAME`. Add `WA_TOKEN` + `WA_PHONE_ID` later to
   send real WhatsApp messages.
4. **Deploy**. You get a permanent URL like `https://<your-site>.netlify.app`.
   Sign in with `OWNER_MOBILE` / `OWNER_PASSWORD` on your phone.

> **Blobs:** on Netlify, blob storage is provisioned automatically for the site —
> nothing to configure. Data persists across deploys and function invocations.

## Deploy (drag-and-drop / CLI)

```bash
npm install
npm i -g netlify-cli
netlify deploy --build --prod      # links a site, uploads, sets functions
# then add the env vars in the Netlify dashboard and redeploy
```

## Run locally

```bash
npm install
npm i -g netlify-cli
netlify dev            # serves the SPA + functions + a local Blobs sandbox
# open the printed http://localhost:8888
```

## Notes & limits (Netlify specifics)

- **No always-on server** — the API is serverless; a cold start adds a little
  latency on the first request. That's normal.
- **Cron granularity** — the alert scheduler runs every 15 min, so a "21:30"
  daily alert is delivered within ~15 min of that time. Times are treated as IST.
- **WhatsApp** stays in **preview/dry-run** mode until `WA_TOKEN` + `WA_PHONE_ID`
  (Meta Cloud API) are set; then it goes LIVE automatically.
- **Concurrency** — blob writes are read-modify-write; fine for a station's
  volume (low concurrent writes). For very high concurrency, use the Render +
  SQLite build or a hosted SQL DB instead.

## Env vars

| Variable | Purpose |
|----------|---------|
| `APP_NAME` | Brand name |
| `JWT_SECRET` | Session signing — **set a strong value** |
| `OWNER_MOBILE` / `OWNER_PASSWORD` | First owner login (created on first request) |
| `OWNER_FIRM_NAME` | Name of the first firm |
| `WA_PROVIDER` / `WA_TOKEN` / `WA_PHONE_ID` | Meta WhatsApp Cloud API |
| `TWILIO_SID` / `TWILIO_TOKEN` / `TWILIO_FROM` | Twilio (if `WA_PROVIDER=twilio`) |
