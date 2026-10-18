# Elyndor Cloudflare Worker website

A Cloudflare Worker serving a static website plus two small JSON endpoints.

## Files
- `public/index.html` — homepage
- `public/404.html` — not-found page
- `src/index.js` — `/api/health`, `/api/progress`, and static asset fallback
- `wrangler.jsonc` — Worker configuration

## Deploy from your computer
Install Node.js, then run:
```sh
npm install
npx wrangler login
npm run dev
npm run deploy
```

## Deploy through GitHub / Workers Builds
1. Add these files to the root of the repository Cloudflare should deploy.
2. Connect that repository to a **Worker** project configured to use Wrangler.
3. Set the deploy command to `npx wrangler deploy`. There is no separate build step.
4. Ensure `wrangler.jsonc` and `src/index.js` are at the configured root directory.

## Test endpoints
- `/` — website
- `/api/health` — Worker health JSON
- `/api/progress` — current progress JSON

## Before publishing
Replace the placeholder Discord and X links in `public/index.html` with the official Elyndor URLs.
