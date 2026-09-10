# marketplace-backend-starter

Backend API for Andy's Marketplace.

## Setup

```bash
npm install
cp .env.example .env   # fill in the values
npm run dev
```

## Structure

- `config/` — app configuration (CORS, etc.)
- `middleware/` — Express middleware
- `routes/` — route definitions
- `controllers/` — request handlers
- `services/` — business logic
- `lib/` — thin wrappers around external integrations (`db.js` for Supabase, `paymentProvider.js` for Optimise Payments)

## Health check

`GET /api/health` → `{ "status": "ok" }`
