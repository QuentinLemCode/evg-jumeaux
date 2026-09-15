# evg-jumeaux

A mobile-first web app for a bachelor party weekend: guests log in, challenge
each other at games — most of them played in the real world — report results,
and climb a leaderboard nobody can quietly falsify.

It is maintained by talking to an agent. A human writes a request on Discord,
Hermes turns it into a specification, a code agent implements it, and CI
deploys it with no downtime. The repository is built so that loop is safe.

```
  Discord / Telegram ──▶ Hermes ──▶ spec agent ──▶ code agent ──▶ push
                                                                    │
  GitHub Actions:  gate ──▶ build image ──▶ GHCR ──────────────────┘
                                              │
                                              ▼
  ┌──────────── GCP VM ────────────────────────────────────────┐
  │  cloudflared ──▶ caddy ──▶ app-blue | app-green  (SQLite)  │
  │       ▲                        one colour live             │
  └───────┼────────────────────────────────────────────────────┘
          │ outbound only — no inbound port
    Cloudflare (DNS, proxy, TLS) ──▶ evg.$DOMAIN
```

## What it does

- **Login** with a first name and a 6-digit PIN. The roster is a committed
  file; there is no sign-up. Sessions last 4 days, and failed attempts hit an
  escalating lockout (3 free, then 10 s → 30 s → 1 min → 5 min → 10 min → 30 min).
- **Leaderboard** ranked on an append-only point ledger, so every total can be
  explained line by line.
- **Matches**: pick a game, pick your opponents (or teams), everyone has 5
  minutes to accept, the winner reports the score, the loser validates or
  disputes it. One match at a time per player.
- **Points**: a fixed amount per win, plus an optional margin bonus the admins
  enable per game — itemised separately, with its arithmetic shown.
- **Notifications**: Web Push plus an in-app inbox, with a per-event TTL and
  urgency so a sleeping phone gets the invitation and not yesterday's news.
- **Admin**: create and tune games, arbitrate disputes, cancel a match, adjust
  points by hand — every one of those with a stated reason.
- **Public admin log** at `/admin-log`: every admin intervention on points or
  results, readable by every player, with the reason and the signed delta.
- **History**: every match kept, including cancelled and expired ones, plus a
  per-player profile showing each point earned.

## Repository map

| Path | What |
|---|---|
| `AGENTS.md` | the operating manual for every agent — read it first |
| `specs/` | the product contract, numbered and versioned |
| `docs/` | architecture, the agent pipeline, deployment, decisions |
| `scripts/agent/` | the shell contract Hermes calls, plus deploy and alerting |
| `hermes/` | gateway system prompt and tool registry |
| `src/` | the app: `app/` pages, `lib/` logic, `db/` schema |
| `terraform/` | the VM, Cloudflare DNS and tunnel, the startup script |
| `.github/workflows/` | the gate, the image build, the deploy, the infra |

## Getting started

```bash
npm install
cp .env.example .env         # then fill AUTH_SECRET
openssl rand -base64 48      # → AUTH_SECRET
npm run vapid:generate       # → the VAPID keys, for push notifications

npm run db:migrate
npm run db:seed
npm run dev                  # http://localhost:3000
```

Every seeded player's development PIN is `123456`. Seeding **refuses to run in
production** while any player still uses it.

## Commands

```bash
npm run dev                 # dev server
npm run typecheck           # tsc --noEmit
npm run lint                # eslint
npm run lint:design         # the Confetti design system (spec 0010)
npm run lint:migrations     # migrations survive a blue/green deploy
npm test                    # unit tests (fast, no database)
npm run test:integration    # integration suite — CI only
npm run build               # production build
npm run db:generate         # new migration after editing src/db/schema.ts
npm run db:migrate          # apply migrations
npm run db:seed             # seed the roster and the default games
npm run hash-pin 482915     # a PIN hash to paste into the seed
npm run vapid:generate      # a VAPID key pair
```

The gate, run by CI and by the code agent before it reports success:

```bash
npm run typecheck && npm run lint:design && npm run lint:migrations \
  && npm test && npm run build
```

## Environment variables

`.env` on the VM is written by Terraform at boot; locally, copy
`.env.example`. Only `AUTH_SECRET` is mandatory for the app to start — it
refuses to boot without it rather than run half-configured.

| Variable | Required | What |
|---|---|---|
| `AUTH_SECRET` | **yes** | signs the session cookie, ≥ 32 chars. Changing it logs everybody out. |
| `DATABASE_PATH` | no | defaults to `./data/evg.db` |
| `SITE_DOMAIN` | production | the FQDN, used for the health URL |
| `HEALTH_URL` | no | defaults to `https://$SITE_DOMAIN/api/health` |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | for push | from `npm run vapid:generate` |
| `VAPID_PRIVATE_KEY` | for push | never reaches the client |
| `VAPID_SUBJECT` | for push | `mailto:you@example.com` |
| `GIT_COMMIT` | set by deploy | reported by `/api/health` to prove a restart |
| `IMAGE_REPOSITORY`, `IMAGE_TAG` | production | which image the stack runs |
| `COMPOSE_FILE`, `COMPOSE_PROFILES`, `CADDY_SITE_ADDRESS` | production | set by Terraform, rewritten by the deploy script |

`deploy.env` on the VM holds what must **not** reach the app containers:
`GHCR_USERNAME`, `GHCR_TOKEN`, `DISCORD_WEBHOOK_URL`, `TELEGRAM_BOT_TOKEN`,
`TELEGRAM_CHAT_ID`. `cloudflared.env` holds `TUNNEL_TOKEN` alone.

## GitHub secrets and variables

Everything below goes in **Settings → Secrets and variables → Actions**.
Values that identify or authorise go in **Secrets**; the rest in **Variables**,
so they stay readable in the logs when something goes wrong.

### Secrets

| Name | Used by | How to get it |
|---|---|---|
| `GCP_PROJECT_ID` | infra | your GCP project id |
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | infra | [keyless auth setup](https://github.com/google-github-actions/auth#preferred-direct-workload-identity-federation) |
| `GCP_SERVICE_ACCOUNT` | infra | same; needs `roles/compute.admin` + `roles/iam.serviceAccountUser` |
| `TF_STATE_BUCKET` | infra | the GCS bucket you create by hand (below) |
| `TAILSCALE_AUTHKEY` | infra | a **reusable** key, Tailscale admin → Settings → Keys |
| `CLOUDFLARE_API_TOKEN` | infra | a scoped token: *Zone → DNS → Edit* on the zone, **and** *Account → Cloudflare Tunnel → Edit*. Not the global key. |
| `CLOUDFLARE_ACCOUNT_ID` | infra | Cloudflare dashboard, right-hand column |
| `CLOUDFLARE_ZONE_ID` | infra | the zone's overview page |
| `DOMAIN` | infra, deploy | your root domain, e.g. `example.com`. A secret so it stays out of the logs. |
| `AUTH_SECRET` | infra | `openssl rand -base64 48` |
| `VAPID_PUBLIC_KEY` | infra | `npm run vapid:generate` |
| `VAPID_PRIVATE_KEY` | infra | same run — never commit it |
| `LLM_API_KEY` | infra | your Agent Platform API key. Hermes **and** both OpenCode agents share it. |
| `GHCR_PULL_TOKEN` | infra | a GitHub PAT with **`read:packages` only** — it lives on the VM, so it must not be able to write |
| `TS_OAUTH_CLIENT_ID` | deploy | Tailscale admin → Settings → OAuth clients, scope `auth_keys` |
| `TS_OAUTH_SECRET` | deploy | same client |
| `DISCORD_WEBHOOK_URL` | infra, deploy | *optional.* Channel → Integrations → Webhooks. Used for error alerts: a webhook needs no gateway alive, so it works when Hermes is what broke. |
| `DISCORD_BOT_TOKEN` | infra | *optional*, only to talk to Hermes on Discord |
| `TELEGRAM_BOT_TOKEN` | infra | *optional*, from @BotFather |
| `TELEGRAM_CHAT_ID` | infra | *optional*, the chat that receives alerts |

### Variables

| Name | Example | What |
|---|---|---|
| `SITE_REPO_URL` | `https://github.com/you/evg-jumeaux.git` | cloned onto the VM for the deploy scripts |
| `SITE_SUBDOMAIN` | `evg` | gives `evg.$DOMAIN` |
| `INGRESS_MODE` | `tunnel` | `tunnel` (no inbound port) or `public_ip` (80/443 open to Cloudflare only) |
| `VM_HOSTNAME` | `evg-site-agent` | the tailnet name CI connects to |
| `LLM_MODEL` | `google/gemini-3.8-flash` | Hermes and both agents. Check the exact id with `opencode models`. |
| `LLM_PROVIDER` | `google` | the provider id on the OpenCode side |
| `LLM_API_KEY_ENV_NAME` | `GEMINI_API_KEY` | the env var the SDK reads; the wrong name fails silently as "no key" |
| `LLM_BASE_URL` | *(empty)* | only if the Agent Platform key uses a dedicated endpoint |
| `VAPID_SUBJECT` | `mailto:you@example.com` | |
| `IMAGE_TAG` | `main` | the bootstrap tag; deploys pin a sha afterwards |
| `DISCORD_ALLOWED_USERS` | `284102345871466496` | *optional*, who may trigger the pipeline |
| `TELEGRAM_ALLOWED_USERS` | `123456789` | *optional*, same |

### Two things Terraform cannot do for you

1. **The state bucket**, because Terraform cannot create the bucket that holds
   its own state:

   ```bash
   gcloud storage buckets create gs://YOUR-STATE-BUCKET \
     --project=YOUR_GCP_PROJECT --location=europe-west1 \
     --uniform-bucket-level-access
   gcloud storage buckets update gs://YOUR-STATE-BUCKET --versioning
   ```

2. **The tailnet ACL** that lets CI deploy. In the Tailscale admin console, add
   an SSH rule allowing the CI tag to reach the VM as `hermes`:

   ```jsonc
   "tagOwners": { "tag:ci": ["autogroup:admin"] },
   "ssh": [
     {
       "action": "accept",
       "src":    ["tag:ci"],
       "dst":    ["autogroup:self", "evg-site-agent"],
       "users":  ["hermes"]
     }
   ]
   ```

   Without it, the deploy job authenticates to the tailnet and then cannot open
   a shell.

## Deploying

```
main ──▶ gate ──▶ build + smoke-test the image ──▶ GHCR ──▶ deploy ──▶ verify
```

The image is built **once, in CI**, and pulled on the VM — nothing is compiled
on a 4 GB box. The deploy itself is blue/green behind a graceful Caddy reload,
so a release drops no connection and a failed release changes nothing.

```bash
tailscale ssh hermes@evg-site-agent
cd ~/site
scripts/agent/deploy.sh --status        # colour, image, commit, health
scripts/agent/deploy.sh --tag sha-a1b2c3d --commit a1b2c3d
scripts/agent/deploy.sh --rollback      # code only — never the database
scripts/agent/watch-errors.sh --test    # prove the alert channel works
```

**A migration must survive the switch**: for a few seconds the previous release
runs against the new schema, so migrations are additive only and
`npm run lint:migrations` fails the build otherwise. Renaming a column takes
three releases. The rules, and why, are in `AGENTS.md` §8.

Full setup, rollback and operational notes: [docs/deployment.md](docs/deployment.md).

## How changes get made

Spec-driven: the specification changes first, always.

```bash
scripts/agent/status.sh                        # what is live?
scripts/agent/pipeline.sh "<what you want>"    # spec → code → review → deploy
scripts/agent/pipeline.sh --no-deploy "..."    # everything except production
```

The pipeline stops on its own when a request is ambiguous, and tells you which
question to answer. Read [docs/agent-pipeline.md](docs/agent-pipeline.md)
before relying on it, and `AGENTS.md` before editing anything by hand.

## Before the party

1. **Put the real guests in `src/db/seed/users.ts`** — id, name, role, avatar.
   At least one must be an `admin`. An id is permanent: matches and points
   reference it forever.
2. **Give everyone a real PIN.** `npm run hash-pin 482915`, paste the hash as
   their `pinHash`, send each person their own PIN privately. Never commit one.
3. **Check the alert channel** with `scripts/agent/watch-errors.sh --test`.
4. **Tell iPhone users to install the app.** iOS only delivers Web Push to an
   installed PWA, and the installed app has its own session — so install
   *before* logging in. The login screen says so, on iOS only.
5. **Tune the games** in `/admin/games`: points per win, and whether a margin
   bonus applies.

## Conventions

- TypeScript everywhere, `strict`, no `any`.
- **Code, comments, commits and markdown in English. User-facing strings in
  French.**
- Mobile-first: designed at 390px, 44px tap targets, the Confetti design
  system (spec 0010) enforced by `lint:design`.
- Match state changes only through `src/lib/domain/match-state.ts`; points only
  through `src/lib/domain/scoring.ts`.
- Migrations are additive only (`AGENTS.md` §8).

The rest is in `AGENTS.md`.
