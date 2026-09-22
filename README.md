# evg-jumeaux

A mobile-first web app for a bachelor party weekend: guests log in, challenge
each other at games — most of them played in the real world — report results,
and climb a leaderboard nobody can quietly falsify.

It is maintained by talking to an agent. A human writes a request on Discord,
Hermes turns it into a specification, a code agent implements it, and CI
deploys it with no downtime. The repository is built so that loop is safe.

```
  ┌──── agents VM (e2-medium) ───────────────────────────────────┐
  │  Discord/Telegram ─▶ Hermes ─▶ spec agent ─▶ code agent      │
  │                                                  │           │
  │  watcher ──────── watches the app from outside ───┼──▶ alert  │
  └──────────────────────────────────────────────────┼───────────┘
                                                     │ pull request
  ┌──── GitHub Actions ─────────────────────────────  ▼ ─────────┐
  │  PR:   quick + tests + e2e  ─▶ required check ─▶ auto-merge  │
  │  main: quick + tests ─▶ build image ─▶ GHCR ─▶ deploy        │
  └──────────────────────────────────────────┬───────────────────┘
                                             │ tailscale ssh
  ┌──── app VM (e2-small) ──────────────────  ▼ ─────────────────┐
  │  cloudflared ──▶ caddy ──▶ app-blue | app-green   (SQLite)   │
  │       ▲                    one colour live, zero-downtime    │
  └───────┼──────────────────────────────────────────────────────┘
          │ outbound only — no inbound port
    Cloudflare (DNS, proxy, TLS) ──▶ evg.$DOMAIN
```

**Two VMs, on purpose.** An agent's `npm ci` and build occupy CPU and memory
for minutes; on a shared machine that shows up in the site's response time,
during the party. The app VM is small (fewer than 50 players, and nothing is
built on it) and holds no LLM key; the agents VM holds no application secret.

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
- **Browser errors reported** at `/admin/errors`: a render crash, an uncaught
  exception or a rejected promise in a guest's browser is grouped by cause and
  arrives with its stack trace, the logged-in player and the browser — plus an
  alert on the first occurrence. Production source maps ship, so the traces are
  readable rather than `a.b is not a function at r (page-4f2c.js:1:28104)`.
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
| `e2e/` | end-to-end tests, one tag per spec |
| `terraform/` | the VM, Cloudflare DNS and tunnel, the startup script |
| `.github/workflows/` | the gate, the image build, the deploy, the infra |

## Getting started

```bash
nvm use                      # Node 26, from .nvmrc
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
npm run lint:e2e-coverage   # every spec has an end-to-end test
npm run e2e                 # the end-to-end suite (needs a browser)
npm run e2e:ui              # …the same, in Playwright's UI mode
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
  && npm run lint:e2e-coverage && npm test && npm run build
```

### End-to-end tests

**Every numbered spec must have at least one end-to-end test** — a spec with
unit tests only is not done (`AGENTS.md` §9). The unit tests would all still
pass if the "Accepter le défi" button were wired to nothing; the flow that
matters needs two people, two sessions and a server.

The link is a Playwright tag, so it is both checkable and runnable:

```bash
npm run lint:e2e-coverage              # every spec is tagged somewhere
npx playwright test --grep @spec-0004  # just the match lifecycle
npm run e2e                            # the suite: 52 tests, 8 files
```

First run needs a browser: `npx playwright install --with-deps chromium`. The
suite runs against a **production build** on a throwaway SQLite file, seeded
from scratch — `playwright.config.ts` handles the server, the database and the
reset. CI runs it on every push.

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
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | infra | [keyless auth setup](docs/deployment.md#2-keyless-gcp-auth) — the commands there print this value |
| `GCP_SERVICE_ACCOUNT` | infra | same; needs `roles/compute.admin` on the project, `roles/storage.objectAdmin` on the state bucket, and `roles/iam.workloadIdentityUser` **on itself** for the repository's principal |
| `TF_STATE_BUCKET` | infra | the GCS bucket you create by hand (below) |
| `TAILSCALE_AUTHKEY` | infra | a **reusable** key, Tailscale admin → Settings → Keys, with **no tag on it**. The VMs apply their own (`--advertise-tags=tag:evg-app` / `tag:evg-agents`), and a tagged key overrides that flag — one key cannot give two machines two different tags. Distinct from the CI credential above, which *does* carry `tag:ci`. |
| `CLOUDFLARE_API_TOKEN` | infra | a scoped token: *Zone → DNS → Edit* on the zone, **and** *Account → Cloudflare Tunnel → Edit*. Not the global key. |
| `CLOUDFLARE_ACCOUNT_ID` | infra | Cloudflare dashboard, right-hand column |
| `CLOUDFLARE_ZONE_ID` | infra | the zone's overview page |
| `DOMAIN` | infra, deploy | your root domain, e.g. `example.com`. A secret so it stays out of the logs. |
| `AUTH_SECRET` | infra | `openssl rand -base64 48` |
| `SEED_PIN_HASHES` | infra | `npm run generate-users -- <roster-file>`, then `gh secret set SEED_PIN_HASHES < .secrets/seed-pin-hashes.b64`. Base64-encoded JSON of id → bcrypt hash. **No PIN hash goes in the repository**: a 6-digit PIN behind bcrypt falls to a GPU in minutes. |
| `VAPID_PUBLIC_KEY` | infra | `npm run vapid:generate` |
| `VAPID_PRIVATE_KEY` | infra | same run — never commit it |
| `GEMINI_API_KEY` | infra | The key `agy` authenticates with. Must be one the **Gemini API** accepts — a key restricted to `aiplatform.googleapis.com` authenticates and is then refused at the endpoint. One name end to end: secret, Terraform variable, the VM's `.env` and the variable `agy` reads. |
| `AGENT_GITHUB_TOKEN` | infra | a **fine-grained** PAT on this repo for the code agent: *Contents: read/write*, *Pull requests: read/write*, *Workflows: read*. Deliberately **no** admin scope — the agent must not be able to lift the branch protection that constrains it. |
| `GHCR_PULL_TOKEN` | infra | a GitHub PAT with **`read:packages` only** — it lives on the VM, so it must not be able to write |
| `TS_OAUTH_CLIENT_ID` | deploy | Tailscale admin → Settings → OAuth clients, **`auth_keys` write** scope, with **`tag:ci` selected on the client**. The console offers that tag only if it already exists in `tagOwners`, and a client cannot be re-tagged later — one made too early has to be recreated. |
| `TS_OAUTH_SECRET` | deploy | same client |
| `DISCORD_WEBHOOK_URL` | infra, deploy | *optional.* Channel → Integrations → Webhooks. Used for error alerts: a webhook needs no gateway alive, so it works when Hermes is what broke. |
| `DISCORD_BOT_TOKEN` | infra | *optional*, only to talk to Hermes on Discord |
| `DISCORD_ALLOWED_USERS` | infra | *optional*, same shape as the Telegram one |
| `TELEGRAM_BOT_TOKEN` | infra | *optional*, from @BotFather |
| `TELEGRAM_ALLOWED_USERS` | infra | the **numeric** Telegram ids allowed to drive the pipeline, comma-separated (spec 0012). A secret, not a variable, because it sits beside the token and because an id identifies a person. **Empty means nobody is authorised**, not everybody. Get an id from `@userinfobot`. |
| `TELEGRAM_CHAT_ID` | infra | *optional*, the chat that receives alerts |

### Variables

> **Every variable below must be set.** An unset repository variable is not an
> absence: Actions passes `TF_VAR_…=` as an empty string, which *overrides* the
> Terraform default. An unset `SITE_REPO_URL` is a VM that runs `git clone ""`
> and never boots. Terraform now refuses the plan and names the variable rather
> than building that, but it still has to be set.


| Name | Example | What |
|---|---|---|
| `SITE_REPO_URL` | `https://github.com/you/evg-jumeaux.git` | cloned onto the VM for the deploy scripts |
| `SITE_SUBDOMAIN` | `evg` | gives `evg.$DOMAIN` |
| `INGRESS_MODE` | `tunnel` | `tunnel` (no inbound port) or `public_ip` (80/443 open to Cloudflare only) |
| `APP_VM_HOSTNAME` | `evg-app` | the tailnet name CI deploys to. **Must equal Terraform's `app_instance_name`** — two places, and only this one is checked. Unset, the deploy falls back to `evg-app`; set to something the tailnet does not have, it fails naming the machines it does have. |
| `AGENTS_VM_HOSTNAME` | `evg-site-agent` | the tailnet name *Deploy infra* refreshes when run with `refresh_agents`. Same rule as above: it must equal Terraform's `instance_name`, and unset falls back to `evg-site-agent`. |
| `LLM_MODEL` | `gemini-3.8-flash` | The agents, on Antigravity CLI at `--effort high`. Bare slug, no provider prefix. |
| `LLM_PROVIDER` | `antigravity` | The agent runtime: `antigravity`, `opencode` or `claude`. Terraform validates the value. |
| `AGENTS_SERVICE_ACCOUNT` | `evg-agents@PROJECT.iam.gserviceaccount.com` | Attached to the agents VM, giving it Vertex AI with no key. Created by hand — Terraform attaches it but must not be able to mint identities. Commands in [docs/deployment.md](docs/deployment.md). |
| `VAPID_SUBJECT` | `mailto:you@example.com` | |
| `IMAGE_TAG` | `main` | the bootstrap tag; deploys pin a sha afterwards |

### Repository settings (three clicks, and the pipeline depends on them)

1. **Settings → General → Pull Requests → Allow auto-merge.** Without it,
   `gh pr merge --auto` is refused and the agent's PRs wait for a human.
2. **Settings → Rules → Rulesets**, on `main`:
   - *Require a pull request before merging* — this is what stops the agent
     pushing to main;
   - *Require status checks to pass* → add **`Verdict`** and
     **`Guarded paths`**, and only those two;
   - *Require branches to be up to date before merging*.
3. **Allow squash merging**, and nothing else, so `main` stays linear and one
   PR is one commit.

**Two checks, and no more.** `Verdict` is an aggregator that passes when no
job failed, *skipped included* — which is what lets auto-merge work on a
docs-only pull request where the browser suite was legitimately skipped.
Requiring `End-to-end` directly would wedge every such pull request forever,
waiting for a check that will never report.

`Guarded paths` is the second because it answers a different question, and
because of a trap. Adding the `infra-ok` label must be able to unblock a pull
request, so the guard re-runs on a label event. If `Verdict` re-ran then too,
it would judge a run in which every heavy job was skipped — and skipped counts
as passed — so labelling a pull request whose **tests had failed** would report
success and overwrite the failure. So `Verdict` does not run on a label event
at all: it keeps whatever it concluded about the code, and the guard answers
for itself.

That is also why a label costs seconds of CI instead of five minutes: nothing
but the guard re-runs.

### Two things Terraform cannot do for you

1. **The state bucket**, because Terraform cannot create the bucket that holds
   its own state:

   ```bash
   gcloud storage buckets create gs://YOUR-STATE-BUCKET \
     --project=YOUR_GCP_PROJECT --location=europe-west1 \
     --uniform-bucket-level-access
   gcloud storage buckets update gs://YOUR-STATE-BUCKET --versioning
   ```

2. **The tailnet ACL** that lets CI deploy and lets the agents VM read the
   app's logs:

   ```jsonc
{
     "tagOwners": {
       // tag:ci owns ITSELF, and that is not a typo. The CI runner joins with an
       // auth key minted by an OAuth client, and an OAuth client may only mint
       // keys for tags it owns. Listing only autogroup:admin grants humans, not
       // the client, and the join fails with
       //   Status: 403, "calling actor does not have enough permissions"
       // The OAuth client must also be created WITH tag:ci selected.
       "tag:ci":         ["autogroup:admin", "tag:ci"],
       "tag:evg-app":    ["autogroup:admin"],
       "tag:evg-agents": ["autogroup:admin"]
     },

     // ADD to the acls array you already have; do not replace it. A tailnet still
     // carrying the default accept-everything rule already covers this.
     "acls": [
       { "action": "accept", "src": ["autogroup:admin"],            "dst": ["tag:evg-app:22", "tag:evg-agents:22"] },
       { "action": "accept", "src": ["tag:ci"],                     "dst": ["tag:evg-app:22", "tag:evg-agents:22"] },
       { "action": "accept", "src": ["tag:evg-agents"],             "dst": ["tag:evg-app:22"] }
     ],

     "ssh": [
       {
         // YOU. Without this rule you cannot reach either machine:
         //     tailnet policy does not permit you to SSH to this node
         // autogroup:admin, not autogroup:member — on a shared tailnet, member
         // would hand every colleague a shell on these VMs.
         "action": "accept",
         "src":    ["autogroup:admin"],
         "dst":    ["tag:evg-app", "tag:evg-agents"],
         "users":  ["hermes", "root"]
       },
       {
         // CI deploys to the application VM, and refreshes the agents VM when
         // *Deploy infra* is run with refresh_agents. It logs in as hermes, whose
         // sudo is limited to restarting the one gateway unit.
         "action": "accept",
         "src":    ["tag:ci"],
         "dst":    ["tag:evg-app", "tag:evg-agents"],
         "users":  ["hermes"]
       },
       {
         // The agents VM reads the app's logs when it diagnoses an error. It has
         // no shell there in practice — app-exec.sh is an allowlist — but the
         // grant is what the allowlist runs over.
         "action": "accept",
         "src":    ["tag:evg-agents"],
         "dst":    ["tag:evg-app"],
         "users":  ["hermes"]
       }
     ]
   }
   ```

   The VMs apply their own tag with `tailscale up --advertise-tags=…` in the
   startup script, so **the auth key must be created without tags of its own**:
   a tagged key wins and the flag is refused. The CI runner gets `tag:ci` from
   the OAuth client.

Add the Workload Identity Federation pool and service account to that list if
you have not set them up yet — the commands are in
[docs/deployment.md](docs/deployment.md#2-keyless-gcp-auth), along with
[how to run Terraform on your laptop](docs/deployment.md#running-terraform-on-your-laptop).

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

Spec-driven: the specification changes first, always. And the code agent works
in the repository, commits, and **opens a pull request** — it never pushes to
`main` and never deploys.

```bash
scripts/agent/status.sh                       # git, PRs, specs, production
scripts/agent/pipeline.sh "<what you want>"   # spec → code → review → PR
scripts/agent/pipeline.sh --watch "..."       # …and block until it merges
scripts/agent/pipeline.sh --no-pr "..."       # stop before opening the PR
scripts/agent/pr-status.sh                    # where the PRs stand
```

The required checks merge the PR; the Deploy workflow then ships it. So a green
pipeline means *on its way*, not *live* — a distinction the Hermes prompt is
explicit about, because it is the easiest thing to get wrong.

The pipeline stops on its own when a request is ambiguous, and tells you which
question to answer. Read [docs/agent-pipeline.md](docs/agent-pipeline.md)
before relying on it, and `AGENTS.md` before editing anything by hand.

### What a PR costs in Actions minutes

The gate is sized to what changed, because a spec-driven repo produces a lot of
specs-only changes and paying for a browser download on each is how a bill gets
away from you:

| Change | Jobs that run |
|---|---|
| specs or docs only | `quick` (~1 min) |
| terraform only | `quick` + `infra` |
| code | `quick` + `tests` + `e2e` |
| merged to `main` | `quick` + `tests`, then build + deploy — the E2E suite is **not** re-run on the same tree it just passed on |

The browser binary is cached by Playwright version, the small checks share one
`npm ci` instead of three, and PR runs cancel themselves when you push again.

## Before the party

> **Telegram**: mention the bot to reach the pipeline — `@bot /status`, or
> `@bot ajoute un mur de photos`. It answers only to the ids in
> `TELEGRAM_ALLOWED_USERS`, and ignores anything it is not tagged in. The
> gateway is `src/hermes/` (spec 0012); the conversational layer on top of it
> is not built yet. See [hermes/README.md](hermes/README.md).


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

- **Node 26**, pinned to the patch in `.nvmrc`. CI (`node-version-file`), the
  Docker image and the VM's NodeSource repository all follow it, so there is
  one place to bump and nothing to keep in sync by hand.
- TypeScript everywhere, `strict`, no `any`.
- **Code, comments, commits and markdown in English. User-facing strings in
  French.**
- Mobile-first: designed at 390px, 44px tap targets, the Confetti design
  system (spec 0010) enforced by `lint:design`.
- Match state changes only through `src/lib/domain/match-state.ts`; points only
  through `src/lib/domain/scoring.ts`.
- Migrations are additive only (`AGENTS.md` §8).

The rest is in `AGENTS.md`.
