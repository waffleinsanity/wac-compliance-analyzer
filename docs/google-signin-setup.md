# Google Sign-In setup

Server-side OAuth (button → Google → callback → app JWT):

1. Continue with Google → `/api/auth/google/start`
2. Full-page redirect to Google (`prompt=select_account`)
3. Google → `{APP_PUBLIC_URL}/api/auth/google/callback`
4. App → `/login?google_token=...` → signed in

## Google Cloud (must match exactly)

Authorized redirect URIs:

```
http://localhost:5173/api/auth/google/callback
http://127.0.0.1:5173/api/auth/google/callback
https://app-production-c7de.up.railway.app/api/auth/google/callback
```

Authorized JavaScript origins:

```
http://localhost:5173
http://127.0.0.1:5173
https://app-production-c7de.up.railway.app
```

## Env

`backend/.env` (local) / Railway service variables (production):

```env
GOOGLE_CLIENT_ID=....apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=...
APP_PUBLIC_URL=http://localhost:5173
```

Production must set `APP_PUBLIC_URL` to the public Railway URL.

## Verify

```bat
curl http://127.0.0.1:8000/api/auth/google/status
curl https://app-production-c7de.up.railway.app/api/auth/google/status
```

`"enabled": true` means credentials are present. Add the production redirect URI in Google Cloud before testing live sign-in.
