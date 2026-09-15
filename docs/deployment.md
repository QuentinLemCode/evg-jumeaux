# Deployment

One GCP VM, reached only through Cloudflare. `main` is what runs in
production; there is no staging, because a bachelor party lasts a weekend and a
second environment would double the surface for half the benefit.

```
            ┌───────────── GitHub Actions ─────────────┐
  push main │  gate ▸ build image ▸ push to GHCR       │
            │                        │                │
            │   join tailnet ◀───────┘                │
            └────────┬─────────────────────────────────┘
                     │ tailscale ssh
  ┌──────────────────▼──── GCP VM (no inbound port) ───────────────────┐
  │  cloudflared ──▶ caddy ──▶ app-blue  |  app-green                  │
  │       │                     one colour live, SQLite on ./data      │
  │       │          sweeper ──▶ same file                             │
  │       │          watch-errors.timer ──▶ alert + short diagnosis    │
  └───────┼────────────────────────────────────────────────────────────┘
          │ OUTBOUND connection only
    Cloudflare  (DNS, proxy, WAF, TLS termination) ──▶ evg.$DOMAIN
```

## Why the tunnel

`ingress_mode = "tunnel"` is the default because it has strictly fewer moving
parts than a public IP:

| | tunnel | public_ip |
|---|---|---|
| inbound ports | **none** | 80/443, restricted to Cloudflare's ranges |
| origin IP exposed | never | only if the firewall rule is right |
| TLS on the VM | none — Cloudflare terminates | a certificate to obtain and renew |
| bypassing the proxy | impossible | possible if the firewall drifts |

The connector dials out, so there is nothing to port-scan. `public_ip` is kept
as a documented fallback, selected with one variable, for the day Cloudflare
Zero Trust is the thing that is broken.

Note the footgun `public_ip` carries: **published Docker ports bypass ufw**
(Docker writes its own iptables chain). In that mode the real boundary is the
GCP firewall rule admitting only Cloudflare's published ranges. In tunnel mode
no port is published at all.

## First time

### 1. The state bucket, by hand

Terraform cannot create the bucket that holds its own state:

```bash
gcloud storage buckets create gs://YOUR-STATE-BUCKET \
  --project=YOUR_GCP_PROJECT --location=europe-west1 \
  --uniform-bucket-level-access
gcloud storage buckets update gs://YOUR-STATE-BUCKET --versioning
```

### 2. Keyless GCP auth

Follow [Workload Identity Federation](https://github.com/google-github-actions/auth#preferred-direct-workload-identity-federation).
The service account needs `roles/compute.admin` and
`roles/iam.serviceAccountUser`.

### 3. Cloudflare

Create a **scoped** API token — not the global key:

- *Zone → DNS → Edit*, on the zone of your domain
- *Account → Cloudflare Tunnel → Edit*

Terraform then creates the tunnel, its ingress rule and the proxied DNS record
itself. You never touch the Cloudflare DNS panel: the record for
`evg.$DOMAIN` appears as soon as `apply` finishes, pointing at the tunnel.

### 4. The tailnet ACL for CI

Terraform can create the VM and the Tailscale key, but not the ACL that lets
the CI runner open a shell on it. In the Tailscale admin console:

```jsonc
"tagOwners": { "tag:ci": ["autogroup:admin"] },
"ssh": [
  {
    "action": "accept",
    "src":    ["tag:ci"],
    "dst":    ["evg-site-agent"],
    "users":  ["hermes"]
  }
]
```

Also create an OAuth client with the `auth_keys` scope, and put its id and
secret in `TS_OAUTH_CLIENT_ID` / `TS_OAUTH_SECRET`. Without this the deploy
job joins the tailnet and then fails at `ssh`.

### 5. The application secrets

```bash
openssl rand -base64 48      # → AUTH_SECRET
npm run vapid:generate       # → the three VAPID values
```

`AUTH_SECRET` signs the session cookie: changing it logs everybody out.
Regenerating the VAPID keys invalidates every push subscription.

### 6. A read-only GHCR token

The VM pulls the image, so its token needs **`read:packages` and nothing
else**. A token that can also write is a token that can replace the image
you are about to run.

### 7. Secrets and variables in GitHub

The full table is in the [README](../README.md#github-secrets-and-variables).

### 8. Set the real PINs

The roster ships with a shared development PIN, and `npm run db:seed` refuses
to run in production while any player still uses it. For each guest:

```bash
npm run hash-pin 482915
```

Paste the hash as their `pinHash` in `src/db/seed/users.ts`, commit, and send
each person their own PIN privately.

### 9. Apply

Actions → *Deploy infra* → Run workflow. Five minutes or so: the startup
script installs Docker, Tailscale SSH and the agents, writes `.env`, logs in to
GHCR, pulls the image and runs the first deploy. The run summary prints the
site URL, the health URL and the SSH command.

Then prove the alert channel works **before** you need it:

```bash
tailscale ssh hermes@evg-site-agent
cd ~/site && scripts/agent/watch-errors.sh --test
```

## Every release after that

A push to `main` is the whole procedure:

1. **Gate** — typecheck, eslint, `lint:design`, `lint:migrations`, unit tests,
   integration tests, production build, Terraform validate, spec hygiene.
2. **Build** — one image, pushed to GHCR as `sha-<short>` and `main`, with a
   registry build cache. Then **smoke-tested**: migrations are applied in that
   image and `/api/health` must report the commit it was built for. An image
   that cannot answer its own health check never reaches the VM.
3. **Deploy** — the runner joins the tailnet and runs
   `scripts/agent/deploy.sh --tag … --commit …` over Tailscale SSH.
4. **Verify** — the public `/api/health` must report the new commit. If it
   reports the previous one, the container never restarted and the job fails.

Nothing is built on the VM. That removes the OOM risk on a 4 GB box and makes a
release a `docker pull` plus a reload.

## Zero downtime, and what it costs

```
pull image ▸ back up SQLite ▸ MIGRATE (old code still serving)
           ▸ start idle colour ▸ wait for healthy
           ▸ rewrite caddy/upstream.conf ▸ caddy reload  ← the switch
           ▸ verify public health ▸ stop the old colour
```

The switch is a **graceful Caddy reload**, which finishes in-flight requests
against the old upstream and sends new ones to the new colour. No dropped
connection, no 502 window.

If anything fails before the reload, the old colour is still serving and the
only trace is a backup file. After the reload, the script puts the upstream
back and reloads again.

**The price**: for a few seconds both colours run against the same database, so
**a migration must work for the old code too**. Additive only —
`npm run lint:migrations` fails the build on a drop, a rename, or a new
`NOT NULL` without a default. Renaming a column takes three releases (expand,
backfill, contract). The rules and the reasoning are in `AGENTS.md` §8.

## Rolling back

```bash
scripts/agent/deploy.sh --rollback
```

Code only. **The database is never rolled back**, because reverting it would
destroy results players entered since the deploy. If a migration damaged data,
stop and decide by hand from `data/backups/` — that repair is deliberately not
automated.

## When something breaks

The VM watches itself every two minutes (`evg-watch-errors.timer`) and sends
one message per distinct problem, with a three-line diagnosis:

- `/api/health` unreachable or not `ok` → **🔴 EVG est indisponible**
- errors in the logs while it still answers → **⚠️ Erreurs dans les logs**
- disk over 85 % → **🟠 Disque presque plein** (a full disk makes SQLite fail
  in confusing ways)
- and, when it comes back, **🟢 EVG est de nouveau en ligne** — a channel that
  only ever reports failures gets muted

Three deliberate properties: it **deduplicates** (one alert per distinct
problem per two hours, so a stack trace does not arrive every two minutes until
you mute the channel), the **diagnosis is optional** (a hard 90-second timeout,
falling back to the raw evidence — an alert that never arrives because a model
was slow is not an alert), and it **says recovered**.

```bash
scripts/agent/deploy.sh --status     # colour, image, commit, health
scripts/agent/watch-errors.sh        # run the watcher now
docker compose ps
docker compose logs -f caddy
docker compose logs -f cloudflared   # tunnel connectivity
sudo journalctl -u hermes-gateway -f
sudo journalctl -u evg-watch-errors -f
```

Back the database up by hand before anything risky:

```bash
sqlite3 data/evg.db ".backup '/tmp/evg-$(date +%s).db'"
```

## Things that will bite you

- **`docker compose down -v` removes the Caddy volumes**; the database is a
  bind mount and survives, but use `stop`.
- **The VM is a deploy target, not a workspace.** The deploy job runs
  `git reset --hard origin/main`, so anything edited there vanishes on the next
  release. Fixes go through spec → code → CI.
- **Destroying the infra destroys the database.** It lives on the boot disk.
  Back it up and copy it off the machine first.
- **A rollback does not undo a migration.** That is why migrations are
  additive: the previous image must still run against the current schema.
- **iOS will not show push notifications** until the app is installed to the
  home screen, and the installed app has its own session. The login screen
  says so, on iOS only.
- **`terraform validate` runs on every PR** for a reason: the Cloudflare
  provider renamed a lot of resources between v4 and v5, and this module is
  pinned to `~> 5.0`. A provider bump that breaks a resource name shows up at
  review time, not at apply time.
