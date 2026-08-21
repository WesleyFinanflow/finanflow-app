# FinanFlow production deploy

This repository is a monorepo. Each production service must point to its own app folder.

## Frontend on Vercel

- Root directory: `frontend`
- Build command: `npm run build`
- Output directory: `dist`
- Required environment variable:
  - `VITE_API_URL`: public HTTPS URL of the Railway backend, without a trailing slash.

## Backend on Railway

- Root Directory: `/backend`
- Config File Path, if Railway asks for it: `/backend/railway.json`
- Start Command: `npm start`
- Healthcheck Path: `/api/health`

Required backend variables:

- `MONGODB_URI`
- `JWT_SECRET`
- `CORS_ORIGIN`
- `FRONTEND_URL`

Optional but needed for password reset email:

- `RESEND_API_KEY`
- `EMAIL_FROM`

## Production validation

After Railway deploys the backend, open:

```txt
https://your-api.up.railway.app/api/health
```

Expected response:

```json
{
  "ok": true,
  "app": "FinanFlow API",
  "database": "connected"
}
```

If Railway returns `Application not found`, the public domain is pointing to the wrong service or the service has not deployed.

After the API healthcheck works, redeploy the Vercel frontend with `VITE_API_URL` pointing to that exact Railway URL.
