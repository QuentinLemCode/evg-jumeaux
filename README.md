# evg-site-infra

Infra as code pour le site web de l'EVG : VM GCP (Docker + Tailscale + Hermes
Agent + OpenCode) créée/détruite à volonté via GitHub Actions + Terraform.

## Architecture

- **Terraform** : VM e2-small, IP statique, firewall (80/443 ouverts, 22 fermé)
- **Provisioning** : entièrement dans le startup-script (pas d'étape manuelle)
  généré par `templatefile()` avec les secrets injectés depuis Terraform
- **Accès à la VM** : uniquement via **Tailscale SSH** (`tailscale ssh
  user@evg-site-agent`), pas de clé SSH classique, pas de port 22 public
- **Agents** : Hermes Agent (gateway Discord/Telegram + orchestrateur) et
  OpenCode (codeur, appelé en headless par Hermes) installés et configurés
  non-interactivement au boot

## Setup initial (une seule fois)

### 1. Bucket GCS pour le state Terraform

Terraform ne peut pas créer le bucket qui stocke son propre state, donc à
créer à la main une fois :

```bash
gcloud storage buckets create gs://TON-BUCKET-STATE \
  --project=TON_PROJET_GCP \
  --location=europe-west1 \
  --uniform-bucket-level-access
gcloud storage buckets update gs://TON-BUCKET-STATE --versioning
```

### 2. Auth GCP sans clé (Workload Identity Federation)

Permet à GitHub Actions de s'authentifier sur GCP sans stocker de clé de
service account. Suis le guide officiel :
https://github.com/google-github-actions/auth#preferred-direct-workload-identity-federation

Tu obtiendras deux valeurs à mettre en secrets GitHub :
- `GCP_WORKLOAD_IDENTITY_PROVIDER`
- `GCP_SERVICE_ACCOUNT`

Le service account doit avoir le rôle `roles/compute.admin` (et
`roles/iam.serviceAccountUser`) sur le projet.

### 3. Secrets et variables GitHub

**Settings → Secrets and variables → Actions**

Secrets (sensibles) :
| Nom | Description |
|---|---|
| `GCP_PROJECT_ID` | ID du projet GCP |
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | Depuis l'étape 2 |
| `GCP_SERVICE_ACCOUNT` | Depuis l'étape 2 |
| `TF_STATE_BUCKET` | Nom du bucket créé à l'étape 1 |
| `TAILSCALE_AUTHKEY` | Clé réutilisable depuis https://login.tailscale.com/admin/settings/keys |
| `LLM_API_KEY` | Clé API OpenRouter ou Anthropic |
| `DISCORD_BOT_TOKEN` | Depuis le Discord Developer Portal (optionnel) |
| `TELEGRAM_BOT_TOKEN` | Depuis @BotFather (optionnel) |

Variables (non sensibles) :
| Nom | Exemple |
|---|---|
| `LLM_API_KEY_ENV_NAME` | `OPENROUTER_API_KEY` ou `ANTHROPIC_API_KEY` |
| `LLM_MODEL` | `anthropic/claude-sonnet-4.5` |
| `DISCORD_ALLOWED_USERS` | `284102345871466496` (ton ID Discord) |
| `SITE_REPO_URL` | URL du repo du site à cloner sur la VM (optionnel) |

## Utilisation

- **Créer/mettre à jour l'infra** : onglet Actions → *Deploy infra* → Run workflow
- **Tout détruire** : onglet Actions → *Destroy infra* → Run workflow → taper
  `destroy` dans le champ de confirmation

Après un déploiement, récupère l'IP statique dans les logs du job (`terraform
output`) et pointe ton nom de domaine dessus.

## Se connecter à la VM

```bash
tailscale up   # si pas déjà fait sur ta machine
tailscale ssh <ton_user>@evg-site-agent
```

## Vérifier que les agents tournent

```bash
sudo systemctl status hermes-gateway
sudo journalctl -u hermes-gateway -f
```

## Prochaine étape

Brancher OpenCode comme outil de Hermes pour qu'il puisse transformer les
demandes reçues sur Discord/Telegram en specs techniques puis en code
(`opencode run "<spec>"`), voir le fil de discussion pour le détail de ce
pipeline.
