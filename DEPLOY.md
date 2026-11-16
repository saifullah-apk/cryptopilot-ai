# Deploying CryptoPilot AI to production

CryptoPilot is **not a static site**. It has a Node.js backend that powers the
AI coach, signal generation, paper trading, backtests and the read-only Binance
account. The hosting must run Node.js **22.5 or newer** (the app uses the
built-in `node:sqlite` module).

## Build

```bash
npm run build
npx esbuild server/index.ts --bundle --platform=node --format=esm --target=node22 --outfile=dist-server/server.mjs
```

Upload these to the application root:

- `dist/` — production frontend
- `dist-server/server.mjs` — single-file backend
- `schema/` — SQLite/MySQL schema
- `package.json`

Do **not** upload `.env`, `data/`, or `node_modules/`.

## cPanel / CloudLinux Node.js app

1. cPanel → **Setup Node.js App** → **Create Application**
2. Application root: the folder containing `dist/` and `dist-server/`
3. Application URL: a **subdomain** (recommended) or the domain root —
   mounting under a subfolder such as `/Trade Mentor` breaks absolute
   `/api` and `/assets` URLs.
4. Application startup file: `dist-server/server.mjs`
5. Node version: **22.5+** (24 recommended)
6. Add environment variables in the cPanel UI:
   - `GEMINI_API_KEY` — your Gemini key
   - `GEMINI_MODEL=gemini-3.5-flash`
   - `PAPER_DB_PATH=data/paper.db` (must be writable)
7. Restart the app.

Verify with `https://your-domain/api/health` → `{"ok":true,...}`.

## VPS / Render / Railway

Start command: `node dist-server/server.mjs`, Node 22.5+. Set `HOST=0.0.0.0`
and the platform's `PORT`. Mount a persistent disk for `data/` so the paper
account survives redeploys.

## Binance

- Public market data (prices, candles, WebSocket) needs **no API key**.
- The read-only account view uses a key entered by the user in the app at
  runtime; it is kept in server memory only. Never put Binance keys in the
  frontend or in `.env`.
- The app never places orders, transfers or withdraws.
