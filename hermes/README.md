# Hermes gateway

Hermes is the conversational front door to the pipeline. It runs on the GCP VM
as the `hermes-gateway` systemd unit, bridges Discord/Telegram, and calls the
scripts in `scripts/agent/`.

## What Hermes is and is not

Hermes **orchestrates**. It does not write specs and it does not write code —
it shells out to the spec agent and the code agent, which do. This split is
deliberate: the conversational model is optimised for talking to people on a
phone, and the coding agents are optimised for staying inside a repository's
conventions. Mixing the two produces an agent that is chatty in the codebase
and terse with humans.

## Wiring

1. **System prompt** → `hermes/system-prompt.md`. This is the behaviour
   contract: routing rules, the destructive-request guard, the reporting style.
2. **Tools** → `hermes/tools.json`. Six tools, each a shell command in
   `scripts/agent/` that prints a machine-readable report block.
3. **Working directory** → `/home/hermes/site` (the repo checkout created by
   the Terraform startup script).
4. **Environment** → `/home/hermes/.hermes/.env`, written by the startup
   script. It holds the LLM key, the model, and the bot tokens.

The contract Hermes depends on is the **shell commands and their report
blocks**, not the manifest format. If your Hermes build expects a different
tool-registry shape, translate `tools.json` and keep the commands identical —
nothing else in the repository needs to change.

## Verifying it locally before touching the VM

The scripts do not need Hermes at all, which is the point. Test the pipeline by
hand first:

```bash
scripts/agent/status.sh
scripts/agent/spec.sh "add a podium with medals at the top of the leaderboard"
scripts/agent/code.sh 0010
scripts/agent/pipeline.sh --no-deploy "..."   # spec + code, no production
```

Switch runtimes with one variable:

```bash
AGENT_RUNTIME=claude   scripts/agent/pipeline.sh "..."   # Claude Code headless
AGENT_RUNTIME=opencode scripts/agent/pipeline.sh "..."   # OpenCode (default)
```

Transcripts of every agent run land in `.agent-logs/` (git-ignored).

## On the VM

```bash
tailscale ssh hermes@evg-site-agent
sudo systemctl status hermes-gateway
sudo journalctl -u hermes-gateway -f
```

## Guardrails that matter

- Only the IDs in `DISCORD_ALLOWED_USERS` / `TELEGRAM_ALLOWED_USERS` can
  trigger a mutating tool. Everyone else is read-only.
- `deploy.sh` refuses a dirty tree and any branch other than `main`, and backs
  up the SQLite file before every migration.
- Nothing in the pipeline can reset scores or delete players: there is no tool
  for it. That is intentional — it would need a spec, a code change, and a
  human review to become possible.
