# Google Sign-In setup

Server-side OAuth (same flow as Navy EHIP: button → Google → callback → app JWT):

1. Continue with Google → `/api/auth/google/authorize-url`
2. Full-page redirect to Google (`prompt=select_account`)
3. Google → `{APP_PUBLIC_URL}/api/auth/google/callback`
4. App → `/login?google_token=...` → signed in

Local UI: **`http://localhost:5173`**

## Google Cloud (must match exactly)

Authorized redirect URIs:

```
http://localhost:5173/api/auth/google/callback
http://127.0.0.1:5173/api/auth/google/callback
```

Authorized JavaScript origins:

```
http://localhost:5173
http://127.0.0.1:5173
```

## Env

`backend/.env`:

```env
GOOGLE_CLIENT_ID=....apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=...
APP_PUBLIC_URL=http://localhost:5173
```

## Verify

```bat
curl http://127.0.0.1:8000/api/auth/google/status
```

`"redirect_uri_accepted": true` means sign-in will work.
