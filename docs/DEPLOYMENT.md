# SENTINEL — Deployment Runbook (Cloudflare)

Target: **Cloudflare Pages** for the app (static SPA) and, later, a **separate
Cloudflare Worker** for server-side work (weather fetch, Phase 6). Keeping them
apart guarantees that secrets (service-role key, weather API key) never ship to
the browser.

> Deployment is a Phase 9 activity. The **staging** deployment below is live and
> points at the *development* Supabase project, which contains synthetic data
> only. Do not use it with real people until the Phase 9 checklist (§6) is
> complete and the responsible school authority has signed off.

---

## 0. Current staging deployment

| Item | Value |
|---|---|
| Live URL (stable) | **https://sentinel-app-1jo.pages.dev** |
| Deployment URL (UI shell build) | https://e7c99394.sentinel-app-1jo.pages.dev |
| Previous deployment (Phase 6) | https://08258527.sentinel-app-1jo.pages.dev |
| Previous deployment (Phase 5) | https://606ad0ac.sentinel-app-1jo.pages.dev |
| Weather worker | **https://sentinel-weather.sentinelcshs.workers.dev** (separate Worker project, holds the service-role secret) |
| Cloudflare account | `62991ae0c53627eb96f1207463435b3f` — "Sentinelcshs@gmail.com's Account" |
| Pages project | `sentinel-app` (production branch `main`) |
| Deployed commit | `b8b4caa` |
| Backend | Supabase project `vuqjfigoeuvjieznqyil` (**development** project, synthetic data only) |
| Auth | `site_url` = the deployed origin; redirect allow-list = localhost + the deployed origin |
| Verified | root 200, deep links (`/sos`, `/incidents`, `/dashboard`) 200, CSP + security headers applied, password sign-in from the deployed origin 200, anon read 0 rows |

Sign in with the synthetic accounts: `rls-admin@test.local` / `RlsTestPass123!`
(administrator) and `rls-student@test.local` / `RlsTestPass123!` (student).

---

## 1. What is needed from the account owner

| Item | Why | Where to get it |
|---|---|---|
| Cloudflare account | hosting | dashboard.cloudflare.com |
| Pages project (name e.g. `sentinel`) | hosts the built app | Dashboard → Workers & Pages → Create → Pages |
| `CLOUDFLARE_API_TOKEN` | lets the CLI deploy | Dashboard → My Profile → API Tokens → Create (template: "Edit Cloudflare Workers") with the account's Pages edit permission |
| `CLOUDFLARE_ACCOUNT_ID` | identifies the account | Dashboard → any account page → Account ID (right-hand side) |
| Supabase auth redirect URL for the deployed domain | otherwise sign-in is rejected by Supabase | Supabase → Authentication → URL Configuration |

**Operational note (2026-10-21):** a scoped token was pasted into a chat
transcript while setting this up, so it must be **rotated** — revoke it in
Dashboard → My Profile → API Tokens and create a replacement, then keep it out of
chat and out of the repository (shell session or secret store only).

The SENTINEL Cloudflare account has **two-factor enforcement disabled**
(`settings.enforce_twofactor = false`). Enable it before any real pilot, and
likewise for the Supabase project and the GitHub repository.

Never put the Cloudflare API token in the repository or in any `VITE_` variable.
Keep it in the shell session (or a secret store) for the deploy only.

## 2. Repository preparation (done, committed)

| File | Purpose |
|---|---|
| `public/_redirects` | SPA fallback so deep links (`/sos`, `/incidents`, `/reports`) survive a refresh |
| `public/_headers` | Security headers incl. a strict CSP (no inline scripts are used) and immutable caching for hashed assets |
| `wrangler.toml` | Pages project name, `pages_build_output_dir = "dist"`, no secret bindings |
| `index.html` | Title/description/theme colour for the deployed app |
| `npm run deploy` | `npm run build` + `npx wrangler pages deploy dist --project-name sentinel` |

## 3. First deploy (staging)

```powershell
# 1. Build locally and check the output
npm run build
Get-ChildItem dist              # index.html, assets/, _redirects, _headers

# 2. Set the API token for this session only
$env:CLOUDFLARE_API_TOKEN = "<token>"
$env:CLOUDFLARE_ACCOUNT_ID = "<account id>"

# 3. Deploy (production branch of the Pages project)
npm run deploy
```

The CLI prints the deployment URL, e.g. `https://<hash>.sentinel.pages.dev`.
The stable preview URL is `https://sentinel.pages.dev`.

### GitHub-linked alternative (no token needed locally)
Dashboard → Workers & Pages → your Pages project → Settings → Builds →
connect the `cshs-sentinel/main` repository, build command `npm run build`,
output directory `dist`. Then set the environment variables in
Settings → Environment variables. Cloudflare builds on every push to `main`;
use a `staging` branch for pre-production.

## 4. Environment variables

| Variable | Where | Secret? | Value |
|---|---|---|---|
| `VITE_SUPABASE_URL` | Pages build env (and `.env` locally) | No (public) | `https://vuqjfigoeuvjieznqyil.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | Pages build env (and `.env` locally) | No (public, RLS-protected) | the `anon`/`publishable` key from `.env` |
| `SUPABASE_SERVICE_ROLE_KEY` | **Worker secrets only** | **Yes** | never in the Pages build |
| `WEATHER_API_KEY` (Phase 6) | **Worker secrets only** | **Yes** | never in the Pages build |

The publishable key is safe in the browser **only** because every table has RLS
and the policies are tested (`scripts/verify-rls.mjs`, currently 162/162).

## 5. Required Supabase change before sign-in will work

Supabase Auth currently allows redirects only to `http://localhost:3000`
(`site_url`), and the redirect allow-list is empty. After the first deploy, add
the deployed origin:

```powershell
# via the Supabase Management API (read-modify-write of the auth config)
$env:SUPABASE_ACCESS_TOKEN = "<management token>"
# PATCH https://api.supabase.com/v1/projects/vuqjfigoeuvjieznqyil/config/auth
# body: { "uri_allow_list": "https://sentinel.pages.dev/**,http://localhost:5173/**" }
```

Without this, Supabase rejects the sign-in redirect ("requested path is invalid").

Pilot-only options to consider before the school pilot:
- `disable_signup: true` once accounts are pre-provisioned by the administrator.
- `mailer_autoconfirm: true` (or a custom SMTP provider) because the default
  Supabase mailer is rate-limited on the free tier — new accounts may not
  receive confirmation emails. **Observed:** the free-tier mailer already
  returned `429 over_email_send_rate_limit` during the staging smoke test, so
  passwordless/email-confirmation sign-up is not viable on the free tier
  without a custom SMTP provider.
- A separate Supabase project for the pilot (the current project holds synthetic
  test data only).

## 6. Phase 9 pre-flight checklist (before a school pilot)

- [ ] Deployed on a staging hostname; smoke test: sign in, raise a test report, raise a test SOS, acknowledge and close it, view a schedule, upload a photo.
- [ ] `node scripts/verify-rls.mjs` still 162/162 against the same Supabase project.
- [ ] Supabase auth redirect URL and site URL point at the deployed origin.
- [ ] Service-role key and any weather key exist only as Worker secrets (verify with `wrangler secret list` — never print values).
- [ ] Security headers present: `curl -I https://<host>/` shows CSP, nosniff, DENY frames, referrer policy.
- [ ] Backup/restore rehearsal recorded (`docs/ROLLBACK.md`).
- [ ] Manual fallback briefed to staff (`docs/MANUAL_FALLBACK.md`), including a paper log at the front desk and the escalation phone tree.
- [ ] Response responsibilities assigned to named people (`docs/MANUAL_FALLBACK.md` §4).
- [ ] Synthetic data confirmed: no real learner or staff records in the deployed project.
- [ ] Free-tier quotas checked (Pages build minutes, Supabase projects, mailer limits) — a free tier is not a promise of production-grade availability.
- [ ] Signed off by the responsible school authority (Gate 9).

## 7. Rollback

- **App:** redeploy the previous successful build (Cloudflare Pages keeps build
  history; `npx wrangler pages deployment list` then re-promote), or
  `git revert` + rebuild + redeploy.
- **Database:** migrations are forward-only; see `docs/ROLLBACK.md` for the
  inverse SQL of every migration (0001–0013) and the point-in-time restore
  option.
- **Schema changes are never rolled back automatically** — a migration rollback
  needs explicit approval (it can destroy records).

## 8. Workers (server-side) — Phase 6, implemented

The weather service runs as a **separate Cloudflare Worker** (`sentinel-weather`),
so the service-role secret never reaches the browser bundle:

- `worker/index.ts` — fetches the observation from Open-Meteo, computes the heat
  index with the shared module (`src/features/weather/heatIndex.ts`), stamps
  source/timestamps/units/freshness/rule version, stores the observation and
  serves the advisory;
- `worker/wrangler.toml` — worker configuration; the school coordinates
  (`LATITUDE`, `LONGITUDE`, `LOCATION_LABEL`) are **placeholders** until the real
  location is configured;
- secrets: `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are set with
  `npx wrangler secret put` (never in the repository);
- the app reaches the worker through the public `VITE_WEATHER_WORKER_URL` build
  variable; the worker only allows the app's origin via `ALLOWED_ORIGIN`.

```powershell
# redeploy the worker after a code change
npx wrangler deploy --config worker/wrangler.toml

# rotate the service-role secret
Get-Content <file-with-key> | npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY --config worker/wrangler.toml
```

The worker is type-checked with strict settings through `tsconfig.worker.json`,
which `npm run typecheck` includes.

