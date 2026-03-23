# RETARD STATS API (Server-Side)

## 1) Deploy Cloudflare Worker

Run commands from the `server/` folder:

```bash
npx wrangler login
npx wrangler kv namespace create AUTH_STORE
npx wrangler secret put FACEIT_API_KEY
npx wrangler secret put AUTH_PEPPER
npx wrangler deploy
```

Setup notes:

- After `wrangler kv namespace create AUTH_STORE`, copy the namespace id into `server/wrangler.toml`:
  - `[[kv_namespaces]]`
  - `binding = "AUTH_STORE"`
  - `id = "<your_namespace_id>"`
- `FACEIT_API_KEY` is your FACEIT API key.
- `AUTH_PEPPER` is any long random string (for example 64+ chars). It is used to harden password and session hashing.

Auth data persistence:

- Users and sessions are stored in Cloudflare KV (`AUTH_STORE`), so accounts do not disappear after deploys.
- Passwords are stored only as salted PBKDF2 hashes (with server-side pepper).
- Session tokens are stored only as hashed values (raw token is never stored in KV).

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