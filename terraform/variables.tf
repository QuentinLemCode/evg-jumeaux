variable "project_id" {
  description = "ID du projet GCP"
  type        = string

  validation {
    condition     = length(var.project_id) > 0
    error_message = "project_id est obligatoire (secret GCP_PROJECT_ID)."
  }
}

variable "region" {
  description = "Région GCP"
  type        = string
  default     = "europe-west1"
}

variable "zone" {
  description = "Zone GCP"
  type        = string
  default     = "europe-west1-b"
}

variable "instance_name" {
  description = <<-EOT
    Nom de la VM des AGENTS. Inchangé volontairement : c'est la VM qui existe
    déjà, et la renommer la détruirait pour la recréer.
  EOT
  type        = string
  default     = "evg-site-agent"
}

variable "app_instance_name" {
  description = "Nom de la VM qui héberge l'application, séparée des agents"
  type        = string
  default     = "evg-app"
}

variable "machine_type" {
  description = <<-EOT
    Type de machine de la VM des AGENTS. e2-medium (4 Go) parce qu'elle fait
    tourner OpenCode, Claude Code et le gate complet (`npm ci` + `next build`
    + les tests) — ce qui dépasse 2 Go.
  EOT
  type        = string
  default     = "e2-medium"
}

variable "app_machine_type" {
  description = <<-EOT
    Type de machine de la VM APPLICATIVE. e2-small (2 Go) suffit : moins de
    50 joueurs, et plus rien n'est construit sur cette machine — la CI publie
    l'image, la VM la tire. C'est la séparation des deux VM qui rend cette
    taille possible.
  EOT
  type        = string
  default     = "e2-small"
}

variable "disk_size_gb" {
  description = "Disque de boot de la VM des agents (Go) : dépôt, node_modules, builds"
  type        = number
  default     = 30
}

variable "app_disk_size_gb" {
  description = <<-EOT
    Disque de boot de la VM applicative (Go). 20 Go : l'image, quelques
    couches Docker, la base SQLite et 20 sauvegardes. Le watcher alerte au-delà
    de 85 % d'utilisation.
  EOT
  type        = number
  default     = 20
}

# --- Tailscale ---------------------------------------------------------------

variable "tailscale_authkey" {
  description = "Clé d'authentification Tailscale (réutilisable), générée sur https://login.tailscale.com/admin/settings/keys"
  type        = string
  sensitive   = true

  validation {
    condition     = startswith(var.tailscale_authkey, "tskey-")
    error_message = "tailscale_authkey doit commencer par « tskey- » (secret TAILSCALE_AUTHKEY)."
  }
}

# --- LLM (utilisé par Hermes Agent ET OpenCode) -------------------------------

variable "agents_service_account" {
  description = <<-EOT
    Service account attaché à la VM des agents. Il leur donne Vertex AI par le
    serveur de métadonnées, donc AUCUNE clé d'API n'est stockée sur la machine.

    Créé à la main, pas par Terraform : le compte de service de la CI n'a
    volontairement ni serviceAccountAdmin ni projectIamAdmin — pouvoir créer
    des identités et leur accorder des rôles est précisément ce qu'on ne veut
    pas déléguer à un workflow. Voir docs/deployment.md.
  EOT
  type        = string
  default     = ""
}

variable "llm_api_key" {
  description = "Clé API Agent Platform, partagée par Hermes et par les agents OpenCode"
  type        = string
  sensitive   = true

  validation {
    condition     = length(var.llm_api_key) > 0
    error_message = "llm_api_key est obligatoire (secret LLM_API_KEY)."
  }
}

variable "llm_api_key_env_name" {
  description = <<-EOT
    Nom de la variable d'environnement attendue par le SDK du provider.
    Pour Google/Gemini : GEMINI_API_KEY (ou GOOGLE_GENERATIVE_AI_API_KEY selon
    le SDK). C'est une variable et pas une constante parce que le nom dépend du
    provider, et se tromper produit un échec silencieux « pas de clé ».
  EOT
  type        = string
  default     = "GEMINI_API_KEY"

  validation {
    condition     = can(regex("^[A-Z][A-Z0-9_]*$", var.llm_api_key_env_name))
    error_message = "llm_api_key_env_name doit etre un nom de variable d environnement, ex. GEMINI_API_KEY (variable LLM_API_KEY_ENV_NAME)."
  }
}

variable "llm_provider" {
  description = "Identifiant du provider côté OpenCode (ex: google)"
  type        = string
  default     = "google"

  validation {
    condition     = length(var.llm_provider) > 0
    error_message = "llm_provider est obligatoire (variable LLM_PROVIDER)."
  }
}

variable "llm_base_url" {
  description = <<-EOT
    URL de base du provider, si la clé Agent Platform passe par un endpoint
    dédié plutôt que par l'API publique. Laisser vide pour l'endpoint par
    défaut du SDK.
  EOT
  type        = string
  default     = ""
}

variable "llm_model" {
  description = <<-EOT
    Modèle utilisé par Hermes ET par les agents de spec/code, au format
    provider/modèle. Vérifie l'identifiant exact avec `opencode models` : une
    faute de frappe ici ne se voit qu'au premier appel.
  EOT
  type        = string
  default     = "google/gemini-3.8-flash"

  validation {
    condition     = length(var.llm_model) > 0
    error_message = "llm_model est obligatoire (variable LLM_MODEL)."
  }
}

# --- Messagerie ----------------------------------------------------------------

variable "discord_bot_token" {
  description = "Token du bot Discord (laisser vide pour désactiver Discord)"
  type        = string
  default     = ""
  sensitive   = true
}

variable "discord_allowed_users" {
  description = "IDs Discord autorisés à parler au bot, séparés par des virgules"
  type        = string
  default     = ""
}

variable "telegram_bot_token" {
  description = "Token du bot Telegram, obtenu via BotFather (laisser vide pour désactiver Telegram)"
  type        = string
  default     = ""
  sensitive   = true
}

variable "telegram_allowed_users" {
  description = "IDs Telegram autorisés à déclencher le pipeline, séparés par des virgules"
  type        = string
  default     = ""
}

variable "telegram_chat_id" {
  description = "Conversation Telegram où envoyer les alertes d'erreur applicative"
  type        = string
  default     = ""
}

variable "discord_webhook_url" {
  description = <<-EOT
    Webhook Discord pour les alertes d'erreur. Préféré au bot pour ça : un
    webhook n'a besoin d'aucune passerelle en vie, donc l'alerte sort même si
    Hermes est justement ce qui est cassé.
  EOT
  type        = string
  default     = ""
  sensitive   = true
}

# --- Site ------------------------------------------------------------------

variable "site_repo_url" {
  description = "URL du dépôt Git de l'app à cloner sur la VM (laisser vide pour ne rien déployer)"
  type        = string
  default     = ""

  validation {
    condition     = can(regex("^https://", var.site_repo_url))
    error_message = "site_repo_url doit etre une URL https de clone (variable SITE_REPO_URL). Vide, la VM tente un git clone sans argument et ne demarre jamais."
  }
}

# --- Secrets applicatifs -----------------------------------------------------

variable "seed_pin_hashes" {
  description = <<-EOT
    Hashs bcrypt des PIN, par id de joueur, en JSON encodé en base64.
    Produit par `npm run generate-users` (secret SEED_PIN_HASHES).

    Base64 parce que Docker Compose interprète les `$` du `.env` qu'il utilise
    aussi comme env_file : en JSON brut, chaque hash arrive tronqué.
  EOT
  type        = string
  sensitive   = true

  validation {
    condition     = length(var.seed_pin_hashes) > 0 && !startswith(var.seed_pin_hashes, "{")
    error_message = "seed_pin_hashes doit être du JSON encodé en base64, pas du JSON brut (secret SEED_PIN_HASHES)."
  }
}

variable "auth_secret" {
  description = "Signe le cookie de session (min. 32 caractères). Le changer déconnecte tout le monde."
  type        = string
  sensitive   = true

  validation {
    condition     = length(var.auth_secret) >= 32
    error_message = "auth_secret doit faire au moins 32 caractères (secret AUTH_SECRET)."
  }
}

variable "vapid_public_key" {
  description = "Clé publique VAPID pour les notifications push (npm run vapid:generate)"
  type        = string
  default     = ""
}

variable "vapid_private_key" {
  description = "Clé privée VAPID. Ne doit jamais atteindre le navigateur."
  type        = string
  default     = ""
  sensitive   = true
}

variable "vapid_subject" {
  description = "Contact VAPID, au format mailto:"
  type        = string
  default     = ""

  validation {
    # Cross-variable, allowed since Terraform 1.9: web-push refuses to send
    # without a subject, so keys with no subject is a silent no-notifications
    # deploy rather than a configuration error.
    condition     = var.vapid_public_key == "" || can(regex("^(mailto:|https://)", var.vapid_subject))
    error_message = "vapid_subject doit être un mailto: ou une URL https dès que vapid_public_key est renseigné (variable VAPID_SUBJECT)."
  }
}


# --- Cloudflare ---------------------------------------------------------------

variable "cloudflare_api_token" {
  description = <<-EOT
    Jeton d'API Cloudflare. Permissions minimales :
      Zone / DNS / Edit          (sur la zone du domaine)
      Account / Cloudflare Tunnel / Edit
    Un jeton restreint, pas la clé globale du compte.
  EOT
  type        = string
  sensitive   = true

  validation {
    condition     = length(var.cloudflare_api_token) > 0
    error_message = "cloudflare_api_token est obligatoire (secret CLOUDFLARE_API_TOKEN)."
  }
}

variable "cloudflare_account_id" {
  description = "ID du compte Cloudflare (tableau de bord, colonne de droite)"
  type        = string

  validation {
    condition     = can(regex("^[0-9a-f]{32}$", var.cloudflare_account_id))
    error_message = "cloudflare_account_id doit être 32 caractères hexadécimaux (secret CLOUDFLARE_ACCOUNT_ID)."
  }
}

variable "cloudflare_zone_id" {
  description = "ID de la zone Cloudflare du domaine"
  type        = string

  validation {
    condition     = can(regex("^[0-9a-f]{32}$", var.cloudflare_zone_id))
    error_message = "cloudflare_zone_id doit être 32 caractères hexadécimaux (secret CLOUDFLARE_ZONE_ID)."
  }
}

variable "domain" {
  description = "Domaine racine géré par Cloudflare, ex: exemple.com"
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9.-]+\\.[a-z]{2,}$", var.domain))
    error_message = "domain doit être un domaine racine, ex. exemple.com (secret DOMAIN)."
  }
}

variable "site_subdomain" {
  description = "Sous-domaine du site : evg -> evg.exemple.com"
  type        = string
  default     = "evg"

  validation {
    condition     = can(regex("^[a-z0-9-]+$", var.site_subdomain))
    error_message = "site_subdomain doit etre un label DNS, ex. evg (variable SITE_SUBDOMAIN). Vide, le site serait publie sur le domaine racine."
  }
}

variable "ingress_mode" {
  description = <<-EOT
    "tunnel"    : cloudflared ouvre une connexion sortante, AUCUN port entrant,
                  IP d'origine jamais exposée, TLS terminé par Cloudflare.
    "public_ip" : enregistrement A proxifié, 80/443 ouverts aux IP Cloudflare.
    Le tunnel est le défaut parce qu'il a strictement moins de pièces : pas de
    port ouvert, pas de certificat d'origine à renouveler.
  EOT
  type        = string
  default     = "tunnel"

  validation {
    condition     = contains(["tunnel", "public_ip"], var.ingress_mode)
    error_message = "ingress_mode doit valoir \"tunnel\" ou \"public_ip\"."
  }
}

variable "cloudflare_ingress_cidrs" {
  description = <<-EOT
    Plages d'IP autorisées à joindre 80/443 en mode public_ip. Ce sont les
    plages publiées par Cloudflare (https://www.cloudflare.com/ips/) : sans
    cette restriction, n'importe qui connaissant l'IP contourne le proxy.
    Codées en dur plutôt que lues via une source de données : elles changent
    une fois tous les quelques ans, et un `terraform plan` qui bouge tout seul
    est pire qu'une liste à rafraîchir à la main.
  EOT
  type        = list(string)
  default = [
    "173.245.48.0/20",
    "103.21.244.0/22",
    "103.22.200.0/22",
    "103.31.4.0/22",
    "141.101.64.0/18",
    "108.162.192.0/18",
    "190.93.240.0/20",
    "188.114.96.0/20",
    "197.234.240.0/22",
    "198.41.128.0/17",
    "162.158.0.0/15",
    "104.16.0.0/13",
    "104.24.0.0/14",
    "172.64.0.0/13",
    "131.0.72.0/22",
  ]
}

# --- Image applicative -------------------------------------------------------

variable "image_repository" {
  description = "Image publiée par la CI, ex: ghcr.io/moi/evg-jumeaux"
  type        = string

  validation {
    condition     = length(var.image_repository) > 0
    error_message = "image_repository est obligatoire."
  }
}

variable "image_tag" {
  description = <<-EOT
    Tag déployé au premier démarrage. Les déploiements suivants passent par la
    CI, qui épingle un digest — `main` n'est que l'amorce.
  EOT
  type        = string
  default     = "main"

  validation {
    condition     = length(var.image_tag) > 0
    error_message = "image_tag est obligatoire, ex. main (variable IMAGE_TAG)."
  }
}

variable "ghcr_username" {
  description = "Utilisateur GitHub pour l'authentification GHCR sur la VM"
  type        = string

  validation {
    condition     = length(var.ghcr_username) > 0
    error_message = "ghcr_username est obligatoire."
  }
}

variable "ghcr_token" {
  description = "Jeton GitHub en lecture seule (read:packages) pour tirer l'image sur la VM"
  type        = string
  sensitive   = true

  validation {
    condition     = length(var.ghcr_token) > 0
    error_message = "ghcr_token est obligatoire (secret GHCR_PULL_TOKEN, read:packages seulement)."
  }
}


# --- GitHub (l'agent de code ouvre des pull requests) -------------------------

variable "github_token" {
  description = <<-EOT
    Jeton GitHub utilisé par l'agent de code via `gh` : pousser une branche,
    ouvrir une pull request, activer l'auto-merge. Portée minimale pour un
    jeton à granularité fine sur CE dépôt :
      Contents: Read and write
      Pull requests: Read and write
      Workflows: Read      (pour lire l'état des contrôles)
    Volontairement PAS le droit d'administrer le dépôt : l'agent ne doit pas
    pouvoir désactiver la protection de branche qui l'empêche de casser main.
  EOT
  type        = string
  sensitive   = true

  validation {
    condition     = length(var.github_token) > 0
    error_message = "github_token est obligatoire (secret AGENT_GITHUB_TOKEN). Sans lui, le code agent ne peut pas pousser."
  }
}

variable "git_author_name" {
  description = "Nom d'auteur des commits de l'agent"
  type        = string
  default     = "EVG code agent"
}

variable "git_author_email" {
  description = "Adresse d'auteur des commits de l'agent"
  type        = string
  default     = "agent@users.noreply.github.com"
}
