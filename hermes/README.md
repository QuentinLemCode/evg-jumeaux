# Hermes gateway

Hermes is the conversational front door to the pipeline. It runs on the
**agents VM** as the `hermes-gateway` systemd unit, bridges Discord/Telegram,
and calls the scripts in `scripts/agent/`.

The application runs on a **different** VM. Hermes has no shell there: anything
about the running app goes through `scripts/agent/app-exec.sh`, an allowlist of
six verbs over Tailscale SSH. An agent with an open shell on the production host
would eventually use it.

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
3. **Working directory** → `/home/hermes/site` on the agents VM (the checkout
   created by the Terraform startup script). `pipeline.sh` resets it to
   `origin/main` at the start of every run, so it is not a place to keep work.
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
scripts/agent/code.sh 0011
scripts/agent/pipeline.sh --no-pr "..."    # spec + code, no pull request
scripts/agent/pr-status.sh                 # where the PRs stand
```

Remember what the pipeline now ends with: a **pull request**, not a deploy. The
required checks merge it and GitHub Actions ships it, so "the pipeline
succeeded" and "the change is live" are several minutes apart.

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
- **The code agent cannot push to `main`.** It opens a pull request; the branch
  protection rule and the required checks land it. This is the one guardrail
  that does not depend on an agent reading its instructions, and the agent's
  GitHub token has no admin scope with which to lift it.
- `deploy.sh` backs up the SQLite file before every migration and aborts before
  switching if anything fails, leaving the previous release serving.
- Hermes has no shell on the application VM — six allowlisted verbs, no more.
- Nothing in the pipeline can reset scores or delete players: there is no tool
  for it. That is intentional — it would need a spec, a code change, and a
  human review to become possible.
