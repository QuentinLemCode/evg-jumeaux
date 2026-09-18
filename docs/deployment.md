# Deployment

Two GCP VMs, one of them reached only through Cloudflare. `main` is what runs
in production; there is no staging, because a bachelor party lasts a weekend and
a second environment would double the surface for half the benefit.

| VM | Size | Runs | Holds |
|---|---|---|---|
| `evg-app` | e2-small | cloudflared, caddy, the app (blue/green), the sweeper | `AUTH_SECRET`, VAPID keys, the tunnel token, a read-only GHCR token |
| `evg-site-agent` | e2-medium | Hermes, the spec/code/review agents, the watcher | the LLM key, the agent's GitHub token |

**Why two.** An agent running `npm ci` and a production build occupies CPU and
memory for minutes. On a shared machine that lands in the site's response time,
during the party, exactly when it is being used. Splitting also means neither
machine holds the other's secrets, and the app VM can be small: fewer than 50
players, and nothing is built there.

The only path between them is `scripts/agent/app-exec.sh` — six allowlisted
verbs over Tailscale SSH (`status`, `deploy`, `rollback`, `logs`, `ps`,
`health`), not a shell.

```
  ┌──── evg-site-agent (no inbound port) ────────────────────────────┐
  │  Hermes ▸ spec agent ▸ code agent ──▶ pull request               │
  │  watch-errors.timer ──▶ health + logs + disk ──▶ alert           │
  └────────────────────────────────┬──────────────┬──────────────────┘
                                   │ PR           │ tailscale ssh
            ┌─── GitHub Actions ───▼──────────┐   │ (7 verbs)
  merge     │  gate ▸ image ▸ GHCR ▸ deploy   │   │
            └────────┬────────────────────────┘   │
                     │ tailscale ssh              │
  ┌──────────────────▼──── evg-app (no inbound port) ──────────────▼──┐
  │  cloudflared ──▶ caddy ──▶ app-blue  |  app-green                 │
  │       │                     one colour live, SQLite on ./data     │
  │       │          sweeper ──▶ same file                            │
  └───────┼───────────────────────────────────────────────────────────┘
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

No JSON key ever leaves Google: the CI job exchanges its GitHub OIDC token for
a short-lived GCP credential. Substitute your project and repository, then run
it once:

```bash
PROJECT=YOUR_GCP_PROJECT
REPO=YOUR_GITHUB_USER/evg-jumeaux
NUMBER=$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')

gcloud services enable iamcredentials.googleapis.com compute.googleapis.com \
  --project="$PROJECT"

gcloud iam workload-identity-pools create github \
  --project="$PROJECT" --location=global --display-name=GitHub

# The attribute condition is the security boundary: without it, ANY GitHub
# repository on the internet can mint a token for this pool.
gcloud iam workload-identity-pools providers create-oidc github \
  --project="$PROJECT" --location=global --workload-identity-pool=github \
  --issuer-uri=https://token.actions.githubusercontent.com \
  --attribute-mapping='google.subject=assertion.sub,attribute.repository=assertion.repository' \
  --attribute-condition="assertion.repository=='$REPO'"

gcloud iam service-accounts create evg-terraform --project="$PROJECT"
SA=evg-terraform@"$PROJECT".iam.gserviceaccount.com

# compute.admin is enough: Terraform creates an address, two firewall rules
# and two instances, and attaches NO service account to them — so it never
# needs iam.serviceAccountUser.
gcloud projects add-iam-policy-binding "$PROJECT" \
  --member="serviceAccount:$SA" --role=roles/compute.admin

# Let the repository impersonate the service account.
gcloud iam service-accounts add-iam-policy-binding "$SA" --project="$PROJECT" \
  --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/$NUMBER/locations/global/workloadIdentityPools/github/attribute.repository/$REPO"

# The service account also needs the state bucket.
gcloud storage buckets add-iam-policy-binding gs://YOUR-STATE-BUCKET \
  --member="serviceAccount:$SA" --role=roles/storage.objectAdmin

echo "GCP_WORKLOAD_IDENTITY_PROVIDER=projects/$NUMBER/locations/global/workloadIdentityPools/github/providers/github"
echo "GCP_SERVICE_ACCOUNT=$SA"
```

The last two lines print the values of the two GitHub secrets of the same name.

**The failure this step causes when it is half-done.** `Terraform init` fails
with a 403 that names the bucket, which sends you looking at the bucket:

```
Failed to get existing workspaces: querying Cloud Storage failed: …
status code 403: Permission 'iam.serviceAccounts.getAccessToken' denied
```

The bucket is not the problem. `iam.serviceAccounts.getAccessToken` is the
*impersonation* step: the federated token was issued, and exchanging it for the
service account's token was refused. Three separate grants have to be in place,
and a missing one always surfaces as this single error:

| Missing | Symptom |
|---|---|
| `roles/iam.workloadIdentityUser` on the SA, for the repository's principalSet | this 403 |
| `roles/storage.objectAdmin` on the state bucket | a 403 naming the bucket, *after* impersonation succeeds |
| `roles/compute.admin` on the project | `apply` fails, `init` succeeds |

Check the first with:

```bash
gcloud iam service-accounts get-iam-policy "$SA" --project="$PROJECT"
```

An empty policy means nothing can impersonate it, whatever else is configured.

Scope that binding to the **repository**, not the owner. An
`--attribute-condition` of `assertion.repository_owner == 'you'` lets every
repository you own — including one you create tomorrow, and a fork — mint a
token for this service account.

### 3. Cloudflare

Create a **scoped** API token — not the global key:

- *Zone → DNS → Edit*, on the zone of your domain
- *Account → Cloudflare Tunnel → Edit*

Terraform then creates the tunnel, its ingress rule and the proxied DNS record
itself. You never touch the Cloudflare DNS panel: the record for
`evg.$DOMAIN` appears as soon as `apply` finishes, pointing at the tunnel.

### 4. The tailnet ACL

Terraform creates the VMs and joins them to the tailnet, but not the policy
that lets CI deploy and the agents VM read the app's logs.

**Machines are named by tag, never by hostname.** A Tailscale SSH rule accepts
tags, users, and entries from the `hosts` section in `src` and `dst` — a bare
machine name is rejected:

```
Error: [ssh] "evg-site-agent" is not allowed in src
Error: invalid dst "evg-app"
```

Each VM applies its own tag with `tailscale up --advertise-tags=…` from its
startup script — `tag:evg-app` and `tag:evg-agents` — and the CI runner gets
`tag:ci` from the OAuth client. So the **auth key must be created without tags
of its own**: a tagged key wins, and `--advertise-tags` is then refused.

**Three parties need a rule, not two.** The rules below cover CI and the
agents VM *and you*: without the operator rule, `tailscale ssh` answers

```
tailnet policy does not permit you to SSH to this node
```

on both machines, which is how you lock yourself out of your own
infrastructure. `autogroup:admin` rather than `autogroup:member`: on a tailnet
shared with anyone else, member would hand them a shell on these VMs.

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

**Applying a tag to a machine that is already running.** `--advertise-tags`
only *requests* the tag; on a node that is already authenticated it takes a
reauthentication to take effect, and `tailscale up` merely prints a login URL.
`--force-reauth` drops the Tailscale connection, so running it over Tailscale
SSH kills the session that is running it. Two ways out:

```bash
# On the VM, detached so losing the SSH session does not kill it:
sudo systemd-run --unit=retag --collect \
  tailscale up --ssh --advertise-tags=tag:evg-app --authkey=tskey-... --force-reauth

# Or simply reboot: the startup script carries both the auth key and the tag,
# and it is idempotent, so a boot re-applies the whole configuration.
sudo reboot
```

Check the result on the machine itself:

```bash
tailscale status --json | jq .Self.Tags     # ["tag:evg-app"], or null
```

An untagged VM is invisible to `tag:ci`, which is what
`No peers visible at all` in the deploy log means.

**If you are already locked out**, the policy editor in the Tailscale admin
console is the way back in — it is a web UI and needs no SSH. There is no
other route: the GCP firewall denies inbound 22 (`evg-deny-ssh-public`), so
`gcloud compute ssh` cannot reach the machines either; only the serial console
can, and it needs a password that was never set.

Nothing grants the app VM access to the agents VM, deliberately: the app has no
reason to reach the machine holding the LLM and GitHub credentials.

Hostnames still work for *connecting* — `tailscale ssh hermes@evg-app` resolves
through MagicDNS. It is only the policy file that cannot name them.

### How CI gets onto the tailnet

`TS_OAUTH_CLIENT_ID` / `TS_OAUTH_SECRET`: an OAuth client with the
**`auth_keys` write** scope, which mints a `tag:ci` key per run so nothing
expires.

Two things about it produce the same 403, and the second one is why it is worth
reading twice:

1. **`tag:ci` must own itself** in `tagOwners` (above). Ownership by
   `autogroup:admin` grants *humans*; the client is not a human.
2. **`tag:ci` must be selected on the client itself** — and the console only
   *offers* that tag if it already exists in `tagOwners`. Create the client
   **after** applying the policy, or the selector is empty and you will
   conclude, reasonably, that there is no such option. **Tags cannot be added
   to an existing client**: one created too early has to be deleted and
   replaced.

### Two auth keys, and only one of them is tagged

This trips people, because the two look like the same kind of credential:

| Credential | Tag on the credential? | Why |
|---|---|---|
| The CI one (`TS_OAUTH_*`) | **yes**, `tag:ci` | the runner has no other way to be `tag:ci` |
| `TAILSCALE_AUTHKEY` (the VMs) | **no** | each VM applies its own tag with `--advertise-tags`, and a tagged key overrides that flag — one key cannot give two machines two different tags |

So `TAILSCALE_AUTHKEY` must be a plain reusable key with the Tags field left
empty. Its owner has to be a `tagOwner` of `tag:evg-app` and `tag:evg-agents`,
which `autogroup:admin` covers.

If it was created **with** a tag, the VMs' `--advertise-tags` is refused and
they stay untagged — invisible to `tag:ci`, and unreachable by the ssh rules
that name those tags. Check on each machine:

```bash
tailscale status --json | jq .Self.Tags     # ["tag:evg-app"], or null
```

`null` with a tagged key is that mistake. Recreate the key without tags, then
reboot the VM.

Either one missing and the join fails five times with

```
Status: 403, Message: "calling actor does not have enough permissions to perform this function"
```

and then — this is the part that wastes the afternoon —
**`tailscale/github-action` reports the step as SUCCESSFUL anyway.** Its retry
loop ends without propagating the failure. Every later step then fails as if
the tailnet policy were wrong, because from the runner's point of view there is
no tailnet at all. The deploy's own preflight checks `BackendState` first for
exactly this reason, and says so.

### The LLM key, and the endpoint it is allowed to reach

Nothing about this is guessable, and getting it wrong means every agent fails
with an error that sounds like a quota problem.

An Agent Platform / **Vertex AI express** key is restricted, at the
organisation level, to `aiplatform.googleapis.com`:

```
constraints/iam.managed.disableServiceAccountApiKeyCreation
"...unless the API Key's API targets are exclusively limited to the allowedServices"
```

You cannot widen it — the restriction is an org policy, not a setting on the
key. And OpenCode's `google` provider calls
`generativelanguage.googleapis.com` by default, which that key is forbidden to
reach:

```
Error: Requests to this API generativelanguage.googleapis.com ... are blocked.
```

So point it at the endpoint the key *is* allowed to use, with the
`LLM_BASE_URL` variable:

```
LLM_BASE_URL = https://aiplatform.googleapis.com/v1/publishers/google
```

The provider appends `/models/<model>:generateContent`, which is exactly the
Vertex express shape. Verified by hand before trusting it:

```bash
curl -s -o /dev/null -w '%{http_code}\n' \
  "https://aiplatform.googleapis.com/v1/publishers/google/models/gemini-3.8-flash:generateContent?key=$GEMINI_API_KEY" \
  -H 'content-type: application/json' \
  -d '{"contents":[{"role":"user","parts":[{"text":"ok"}]}]}'
```

`200` and you are done; `403` means the base URL is wrong for your key. Note
that model availability differs between the two endpoints: on this project
`gemini-3.8-flash` and `gemini-2.5-flash` answer, `gemini-2.0-flash` is a 404.

**Not every Gemini model survives a long agent run.** `gemini-3.8-flash`
answers short prompts fine and then dies partway through a spec agent's
exploration, after twenty-odd tool calls:

```
Error: Requests ending with a model turn are not supported.
```

That is the API refusing a conversation whose last entry is a model turn —
something the client built, not something the repository can fix. Measured on
this project, against this endpoint:

| Model | Short prompt | Long tool loop (spec agent) |
|---|---|---|
| `gemini-2.5-pro` | works | **works** — completed a spec end to end |
| `gemini-2.5-flash` | works | untested |
| `gemini-3.8-flash` | works | **fails** with the error above |
| `gemini-2.0-flash` | 404 on this endpoint | — |

So `LLM_MODEL` is `google/gemini-2.5-pro`: the spec, code and review agents all
run long tool loops and none of them may be the one that discovers this again.
The router (spec 0013) stays on `gemini-2.5-flash` in `.opencode/opencode.json`
— its calls are short, frequent, and it is the one a human waits on.

If you change the model, run one real `scripts/agent/spec.sh` against it before
trusting it. A short prompt proves nothing here.

Two APIs must also be enabled on the project, and Terraform does not do it —
enabling services would need a role the CI service account deliberately does
not have:

```bash
gcloud services enable aiplatform.googleapis.com generativelanguage.googleapis.com \
  --project=YOUR_GCP_PROJECT
```

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

## Running Terraform on your laptop

`apply` normally runs from the *Deploy infra* workflow, so one identity writes
the state and every change is in a log. Running it locally is for reading — a
`plan` before you approve a change, `state show` when you are diagnosing.

**Checks that need no credentials at all.** This is what CI's `infra` job runs
on a pull request, and what to run before pushing:

```bash
cd terraform
terraform init -backend=false   # providers only, no state
terraform fmt -check -recursive
terraform validate
```

`fmt -check` is a required check, and its alignment rules changed in 1.16 —
`.tool-versions`, `backend.tf` and all three workflows agree on the version, so
keep the local binary at 1.16 or later.

**A real plan, against the real state.** Two credentials, neither of them a
downloaded key file:

```bash
gcloud auth application-default login   # the google provider reads ADC
cd terraform
terraform init -reconfigure \
  -backend-config="bucket=YOUR-STATE-BUCKET" \
  -backend-config="prefix=evg-jumeaux/infra"
```

The bucket is deliberately absent from `backend.tf` (a partial backend
configuration) so the repository names no environment. Your Google account
needs `roles/storage.objectAdmin` on that bucket and `roles/compute.viewer` on
the project to plan.

Every variable without a default has to be supplied. Do it through the
environment rather than a file, so a token never lands on disk:

```bash
export TF_VAR_project_id=…            TF_VAR_domain=…
export TF_VAR_cloudflare_api_token=…  TF_VAR_cloudflare_account_id=…
export TF_VAR_cloudflare_zone_id=…
export TF_VAR_tailscale_authkey=…     TF_VAR_llm_api_key=…
export TF_VAR_auth_secret=…
export TF_VAR_image_repository=ghcr.io/YOUR_USER/evg-jumeaux
export TF_VAR_ghcr_username=…         TF_VAR_ghcr_token=…
export TF_VAR_github_token=…

terraform plan
```

If you prefer a file, call it `terraform.tfvars` — `.gitignore` covers
`*.tfvars` and `*.tfvars.json`.

**Two things that will waste an afternoon.** The Cloudflare provider validates
the shape of `cloudflare_api_token` before it contacts anything, and a token
with a hyphen in it is rejected with an error that looks like a plan failure.
And `.terraform.lock.hcl` **is** committed on purpose: CI and your laptop must
resolve the same provider versions. Change them with `terraform init -upgrade`
and commit the result; never delete the lock file to fix an error.

## Changing the agents VM's configuration

Terraform rewrites that VM's `.env` and its systemd units, but **only a boot
applies them**: `metadata_startup_script` does not re-run when its metadata
changes. So a change to `LLM_MODEL`, to the allowlist, or to the gateway's code
used to need a manual ssh, and the gateway kept running yesterday's
configuration while the run said "success".

*Deploy infra* takes a `refresh_agents` input, on by default, which afterwards:

1. pulls `origin/main` on the VM's checkout;
2. runs `npm ci` **only if `package-lock.json` actually moved** — it takes
   minutes on an e2-medium and most config changes touch no dependency;
3. restarts `hermes-gateway`;
4. waits, then asserts the unit is still active and prints its last lines. A
   restart that exits 0 and then crash-loops looks identical to a good one for
   about five seconds.

Two things make that possible, and both are in the policy rather than the
workflow:

- The tailnet `ssh` rule for `tag:ci` includes `tag:evg-agents` (above).
  Without it the job fails at `ssh` with a policy error.
- `hermes` has a sudoers drop-in limited to **restarting that one unit**, so
  CI never needs root on the agents VM:

  ```
  hermes ALL=(root) NOPASSWD: /usr/bin/systemctl restart hermes-gateway
  ```

Turn `refresh_agents` off when you are only changing the application VM, or
when the agents VM is mid-pipeline and you would rather not interrupt it.

## Every release after that

An agent (or a human) opens a pull request; the required check merges it; the
merge deploys it.

**On the pull request**, the gate is sized to what changed — a specs-only PR
costs about a minute, a code PR runs the browser suite. The one required check
is `Verdict`, an aggregator that passes when nothing failed, skipped included.
That is what lets auto-merge work on a PR where the heavy jobs were legitimately
skipped; requiring `End-to-end` directly would wedge such a PR forever.

**On `main`**, five steps:

1. **Gate** — typecheck, eslint, `lint:design`, `lint:migrations`,
   `lint:e2e-coverage`, spec hygiene, unit tests, integration tests, production
   build. The 52 browser tests are **not** re-run: the merged tree is the tree
   that just passed them on its PR (the ruleset requires the branch to be up to
   date), and the image is smoke-tested at step 2.
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
- **The app VM is a deploy target, not a workspace.** The deploy job runs
  `git reset --hard origin/main`, so anything edited there vanishes on the next
  release. Fixes go through spec → code → PR → CI.
- **Changing a startup script does not re-provision a running VM.** GCP only
  runs it at boot. After editing `templates/startup-*.sh.tpl`, reboot the VM
  (or recreate it) — `terraform apply` alone updates the metadata and nothing
  else, which looks like the change silently did nothing.
- **The agents VM needs its checkout kept current.** `pipeline.sh` resets it to
  `origin/main` at the start of every run, so a half-finished manual edit there
  is lost. Work in a clone on your laptop instead.
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
