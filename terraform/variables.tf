variable "project_id" {
  description = "ID du projet GCP"
  type        = string
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
  description = "Nom de la VM"
  type        = string
  default     = "evg-site-agent"
}

variable "machine_type" {
  description = <<-EOT
    Type de machine GCP. e2-medium (2 vCPU / 4 Go) et pas e2-small : la VM
    construit l'image Docker de l'app (npm ci + next build), ce qui dépasse
    2 Go de RAM et se termine par un OOM kill silencieux au milieu du build.
  EOT
  type        = string
  default     = "e2-medium"
}

variable "disk_size_gb" {
  description = "Taille du disque de boot (Go)"
  type        = number
  default     = 30
}

# --- Tailscale ---------------------------------------------------------------

variable "tailscale_authkey" {
  description = "Clé d'authentification Tailscale (réutilisable), générée sur https://login.tailscale.com/admin/settings/keys"
  type        = string
  sensitive   = true
}

# --- LLM (utilisé par Hermes Agent ET OpenCode) -------------------------------

variable "llm_api_key" {
  description = "Clé API Agent Platform, partagée par Hermes et par les agents OpenCode"
  type        = string
  sensitive   = true
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
}

variable "llm_provider" {
  description = "Identifiant du provider côté OpenCode (ex: google)"
  type        = string
  default     = "google"
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
}

# --- Secrets applicatifs -----------------------------------------------------

variable "auth_secret" {
  description = "Signe le cookie de session (min. 32 caractères). Le changer déconnecte tout le monde."
  type        = string
  sensitive   = true
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
}

variable "cloudflare_account_id" {
  description = "ID du compte Cloudflare (tableau de bord, colonne de droite)"
  type        = string
}

variable "cloudflare_zone_id" {
  description = "ID de la zone Cloudflare du domaine"
  type        = string
}

variable "domain" {
  description = "Domaine racine géré par Cloudflare, ex: exemple.com"
  type        = string
}

variable "site_subdomain" {
  description = "Sous-domaine du site : evg -> evg.exemple.com"
  type        = string
  default     = "evg"
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
}

variable "image_tag" {
  description = <<-EOT
    Tag déployé au premier démarrage. Les déploiements suivants passent par la
    CI, qui épingle un digest — `main` n'est que l'amorce.
  EOT
  type        = string
  default     = "main"
}

variable "ghcr_username" {
  description = "Utilisateur GitHub pour l'authentification GHCR sur la VM"
  type        = string
}

variable "ghcr_token" {
  description = "Jeton GitHub en lecture seule (read:packages) pour tirer l'image sur la VM"
  type        = string
  sensitive   = true
}
