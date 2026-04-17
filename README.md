# waitlist-zo

Self-contained reCAPTCHA v3 waitlist API route for Zo Space.

## Route

- **`/api/waitlist`** — single route, content-negotiated
  - `GET /` → HTML form (browser)
  - `GET /` + `Accept: application/json` → `{ count }` (API)
  - `POST /` → `201` on success, `409` on duplicate, `400` on bad email

## Stack

- Zo Space API route (Hono / Bun)
- reCAPTCHA v3 (invisible, ambient)
- JSON file storage at `/dev/shm/waitlist.json`

## Setup

1. Add your reCAPTCHA v3 keys to [Zo Space secrets](/?t=settings&s=advanced):
   - `RECAPTCHA_SITE_KEY`
   - `RECAPTCHA_SECRET_KEY`

## Deploy

Sync the route in Zo Space → Hosting → Services → zo-space.
