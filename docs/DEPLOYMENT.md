# SENTINEL — Deployment Runbook (Cloudflare)

Target: **Cloudflare Pages** for the app (static SPA) and, later, a **separate
Cloudflare Worker** for server-side work (weather fetch, Phase 6). Keeping them
apart guarantees that secrets (service-role key, weather API key) never ship to
the browser.

> Deployment is a Phase 9 activity. Nothing here has been deployed yet. Do not
> deploy to a production hostname before the Phase 9 pre-flight checklist
> (§6) is complete and the responsible school authority has signed off.

---

## 1. What is needed from the account owner

| Item | Why | Where to get it |
|---|---|---|
| Cloudflare account | hosting | dashboard.cloudflare.com |
| Pages project (name e.g. `sentinel`) | hosts the built app | Dashboard → Workers & Pages → Create → Pages |
| `CLOUDFLARE_API_TOKEN` | lets the CLI deploy | Dashboard → My Profile → API Tokens → Create (template: "Edit Cloudflare Workers") with the account's Pages edit permission |
| `CLOUDFLARE_ACCOUNT_ID` | identifies the account | Dashboard → any account page → Account ID (right-hand side) |
| Supabase auth redirect URL for the deployed domain | otherwise sign-in is rejected by Supabase | Supabase → Authentication → URL Configuration |

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
  receive confirmation emails.
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

## 8. Workers (server-side) — later, Phase 6

When the weather module lands, create a **separate** Cloudflare Worker project:

- `wrangler.toml` in a `worker/` directory with its own `main` and
  `compatibility_date`;
- secrets via `wrangler secret put SUPABASE_SERVICE_ROLE_KEY` and
  `wrangler secret put WEATHER_API_KEY` (never in code or in the Pages build);
- the Worker fetches weather and returns a computed advisory with source,
  timestamp, units, freshness and `rule_version`;
- the browser only ever calls the Worker — never Supabase with a service-role
  key, and never a third-party weather API directly.
