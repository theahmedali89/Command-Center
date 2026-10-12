# Command Center

One free dashboard + shared connection layer to manage all websites (WordPress) and social accounts — operable from the UI **and** by automation (Milo) through the same API. No browser logins. No fake functionality.

**Status: v1 build complete.** Working: auth, WordPress publishing via REST API, dashboard UI, AI content generation (Gemini), media library (R2), scheduling + agent API, audit logging. Social OAuth is scaffolded with honest states — real connections need developer apps (see below).

---

## 1. Quick start (local)

```bash
cd command-center
cp .env.example .env
# fill in .env (see §3)

npm install
npx prisma migrate deploy   # or: npx prisma migrate dev
npm run dev
```

Open http://localhost:3000 → you'll be redirected to `/login`.

**First user:** with an empty database, `POST /api/auth/setup` creates the first account:

```bash
curl -X POST http://localhost:3000/api/auth/setup \
  -H 'Content-Type: application/json' \
  -d '{"email":"you@example.com","password":"a-very-long-password","name":"Ahmed"}'
```

After the first user exists, `/api/auth/setup` returns `403 SETUP_DISABLED` permanently.

## 2. Deploy (Vercel, free tier)

1. Push this folder to a Git repo, import into Vercel.
2. Add a Postgres database (Supabase free tier works; set `DATABASE_URL`).
3. Set the env vars from §3 in Vercel → Settings → Environment Variables.
4. `prisma migrate deploy` runs automatically if you add it to the build command, e.g. `prisma migrate deploy && next build`. Otherwise run it once from your machine with the production `DATABASE_URL`.
5. Set `APP_URL` to your deployment URL (needed for OAuth callbacks).

## 3. Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | ✅ | Postgres connection string |
| `TOKEN_ENCRYPTION_KEY` | ✅ | ≥32 chars. Encrypts stored passwords/tokens (AES-256-GCM) |
| `SESSION_SECRET` | ✅ | ≥32 chars. Signs session cookies |
| `APP_URL` | OAuth only | e.g. `https://your-app.vercel.app` — OAuth callback base |
| `GEMINI_API_KEY` | AI only | Google AI Studio key (free tier) for content generation |
| `GEMINI_MODEL` | optional | Default `gemini-2.0-flash` |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` | Media only | Cloudflare R2 (free 10 GB) |
| `R2_PUBLIC_URL` | optional | Public base URL for served media |
| `FACEBOOK_CLIENT_ID` / `FACEBOOK_CLIENT_SECRET` | FB OAuth | Meta developer app — NEEDS_DEV_ACCOUNT |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | YouTube OAuth | Google Cloud console — NEEDS_DEV_ACCOUNT |
| `PINTEREST_CLIENT_ID` / `PINTEREST_CLIENT_SECRET` | Pinterest OAuth | developers.pinterest.com — NEEDS_DEV_ACCOUNT |
| `TIKTOK_CLIENT_KEY` / `TIKTOK_CLIENT_SECRET` | TikTok OAuth | TikTok developer portal — NEEDS_DEV_ACCOUNT |

Never commit `.env`. The app never returns secret values to the UI — Settings → Integrations shows booleans only.

## 4. Cost visibility ($0/month at personal usage)

| Service | Classification | Purpose |
|---|---|---|
| Vercel | FREE WITH LIMITS | Hosting |
| Supabase Postgres | FREE WITH LIMITS | Database |
| Cloudflare R2 | FREE WITH LIMITS | Media (10 GB free) |
| Gemini API | FREE WITH LIMITS | Content generation |
| WordPress REST API | FREE | Article publishing |
| Facebook Graph API | FREE | Page posting (after pages exist) |
| Telegram Bot API | FREE | Channel broadcasts |
| Threads / Tumblr / Bluesky APIs | FREE | Posting |
| YouTube Data API | FREE WITH LIMITS | Uploads (quota — verify, don't assume) |
| Pinterest API v5 | PLATFORM APPROVAL REQUIRED | May need app review for publishing |
| LinkedIn Share API | PLATFORM APPROVAL REQUIRED | Developer app + OAuth |
| X API | VERIFY | Free-tier limits must be checked before promising volume |
| TikTok Content Posting API | PLATFORM APPROVAL REQUIRED | App audit can be slow |
| Milo runtime scheduler | FREE | Existing cron infra calls `/api/agent/*` |

If any free-tier limit is reached, the app surfaces it — it never silently creates charges.

## 5. How it works

```
Dashboard (you) ─┐
                 ├─▶ Next.js API ─▶ Providers (WP, social) ─▶ Official APIs
Milo crons ──────┘        │                    ▲
              /api/agent/* (API key)   Secure Vault (encrypted tokens)
```

- **Websites:** add any WordPress site via URL + Application Password (wp-admin → Users → Profile). Verified live via `/wp-json/wp/v2/users/me`. Articles publish through the REST API — no browser, no session expiry.
- **Social:** each platform is a provider with declared capabilities. Unconnected platforms honestly show `NOT_CONFIGURED`; platforms awaiting approval show `APPROVAL_REQUIRED`. Publishing never fakes success.
- **Content pipeline:** AI generates structured JSON → deterministic validation (schema → capabilities → length/hashtag limits → media) → you review/edit → approve (version locked) → publish now or schedule.
- **Scheduler:** runs on Milo's existing runtime (Vercel free cron limits are too tight for ~8 daily jobs). It calls `POST /api/agent/run-due` with the agent API key. Publishing is idempotent (duplicate-safe) with bounded exponential-backoff retries.
- **Audit log:** every action records `actorType` (`USER`/`AUTOMATION`/`SYSTEM`/`API`). The UI shows friendly labels; the DB stays generic.

## 6. Agent API (for Milo automation)

Create a key at **Settings → Agent API keys** (shown once — store it securely).

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/agent/status` | GET | Health: website/account counts by status, due now, failed |
| `/api/agent/websites` | GET | Websites (no secrets) |
| `/api/agent/publish` | POST | `{scheduledPostId}` → publish now |
| `/api/agent/run-due` | POST | Publish all due scheduled posts |

Auth: `Authorization: Bearer <key>`. All agent-triggered publishes are audited as `AUTOMATION`.

## 7. Platform notes (honest)

- **WordPress:** fully working now. Yoast title/meta are written only when the site exposes them (capability-detected); otherwise the post publishes without them and reports `yoastApplied: false`.
- **Facebook/Instagram:** connector code is scaffolded; needs a Meta developer app + the new Pages on the new account.
- **Telegram:** needs a bot token from BotFather (provider stub honest until then).
- **YouTube:** OAuth scaffolded; verify current quota before promising upload volume.
- **Pinterest / LinkedIn / X / TikTok:** stubs return honest `NOT_CONFIGURED` / `PLATFORM_APPROVAL_REQUIRED`. No fake posts, ever.
- **Medium:** no API for new tokens — out of scope by design.
- **Reddit / Quora / WhatsApp Channels:** no posting APIs — manual playbooks, not automation targets.

## 8. Ahmed's setup checklist (~1–1.5 hrs, guided)

1. [ ] 3× WordPress Application Passwords (wp-admin → Users → Profile, ~2 min each) → **Sites → Add Website**
2. [ ] Create the 2 Facebook pages on the new account
3. [ ] Instagram → business/creator account
4. [ ] Telegram: channel + bot via BotFather
5. [ ] Developer apps: Pinterest, LinkedIn, TikTok, X (as needed)
6. [ ] YouTube: Google OAuth when asked
7. [ ] (Optional) Gemini API key for AI content generation
8. [ ] (Optional) Cloudflare R2 keys for the media library

## 9. Development

```bash
npm run dev          # local dev
npx tsc --noEmit     # typecheck
npm run lint         # eslint
npm run build        # production build
node --test src/providers/wordpress/client.test.ts   # WP client unit tests (15)
```

Conventions: TypeScript strict, no `any`, zod on all inputs, small files, never log secrets, audit every mutation. Next 16 notes: `src/proxy.ts` (not `middleware.ts`); `cookies()`/`headers()`/`params` are async; pages reading cookies use `await connection()` + `export const instant = false`.

## 10. Troubleshooting

| Symptom | Likely cause |
|---|---|
| `/api/auth/setup` → 403 | A user already exists — use `/login` |
| Website verify → `AUTH_REQUIRED` | Wrong app password (use Application Password, not WP login password) |
| Website verify → `NOT_CONFIGURED` | Not a WP site, or REST API blocked by a security plugin |
| AI generate → `AI_NOT_CONFIGURED` | `GEMINI_API_KEY` not set |
| Media upload → `NOT_CONFIGURED` | R2 env vars not set |
| OAuth start → `NOT_CONFIGURED` | Platform client ID/secret not set — NEEDS_DEV_ACCOUNT |
| Scheduled post stuck in `FAILED` | See `lastSafeErrorMessage`; Retry re-queues (max 5 attempts, backoff) |
| `next build` prerender errors | Pages using cookies need `await connection()` + `instant = false` (already applied) |

## 11. Not in v1 (by design)

Billing, teams/roles, autonomous posting without approval, AI video/image generation, social inbox, comment automation, competitor tracking, mobile apps, browser extensions. The provider architecture keeps extension points for all of these.
