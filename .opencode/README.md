# OpenCode configuration

`opencode.json` here carries what belongs to the **repository**: the
instructions every agent loads, and the agent roster.

## It deliberately does not set a model

It used to, as `"model": "{env:LLM_MODEL}"`, and that cost an afternoon.

OpenCode loads the machine's global config first and this one second, so a
`model` here **silently overrides** whatever the machine was configured with.
The agents VM had `google-vertex/gemini-3.8-flash` in its global config and
`google/gemini-3.8-flash` in the `.env` this file read from — so every agent
went to the Gemini API endpoint, which an org policy blocks, and reported:

```
Requests to this API generativelanguage.googleapis.com ... are blocked.
```

The global config was right. This file overruled it.

Which model to use is a property of the **machine** — of which provider it can
authenticate to — not of the repository. On the agents VM it comes from
Terraform; on a laptop it comes from your own `~/.config/opencode/`. Neither
belongs here.

## The agents VM, for reference

Vertex AI through the service account attached to the instance. No API key, and
**no `GOOGLE_APPLICATION_CREDENTIALS`**: on GCE the metadata server is part of
the ADC chain, so the provider finds its credentials on its own. That file is
only needed off GCE, where `gcloud auth application-default login` writes it.

```json
{
  "model": "google-vertex/gemini-3.8-flash",
  "provider": { "google-vertex": { "options": { "project": "…", "location": "global" } } }
}
```

`location` is `global` because it is the only one that serves the model —
regional endpoints return 404. See `docs/deployment.md`.
