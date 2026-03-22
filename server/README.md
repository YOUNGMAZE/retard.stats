# RETARD STATS API (Server-Side)

## 1) Deploy Cloudflare Worker

Run commands from the `server/` folder:

```bash
npx wrangler login
npx wrangler secret put FACEIT_API_KEY
npx wrangler deploy
```

When prompted for the secret value, paste your FACEIT API key.

## 2) Connect Frontend

Set `VITE_STATS_API_URL` to your Worker URL.

Local `.env` example:

```bash
VITE_STATS_API_URL=https://retard-stats-api.<your-subdomain>.workers.dev
```

For GitHub Pages, add repository secret:

- Name: `VITE_STATS_API_URL`
- Value: `https://retard-stats-api.<your-subdomain>.workers.dev`

Then push to `main` to trigger Pages deploy.