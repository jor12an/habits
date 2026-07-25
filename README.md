# Habits

Private, mobile-first habit tracker (local-only PWA).

## Quick start

```bash
python -m http.server 8080 --directory public
```

Open **http://127.0.0.1:8080/**

## Cloudflare deploy

**Static files live in `public/` only** (never upload `node_modules`).

### Option A — Pages (Connect to Git) — recommended

| Setting | Value |
|--------|--------|
| Build command | *(empty)* or `npm run build` |
| Build output directory | `public` |
| Root directory | *(empty)* |
| Deploy command | *(leave empty / none)* |

### Option B — Workers static assets

| Setting | Value |
|--------|--------|
| Build command | `npm run build` |
| Deploy command | `npx wrangler deploy` |

`wrangler.toml` points assets at `./public` only.

## Docs

See **[PROJECT.md](./PROJECT.md)** for features, score algorithm, data model, and structure.
