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
  description = "Type de machine GCP"
  type        = string
  default     = "e2-small"
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
  description = "Clé API du provider LLM (ex: clé OpenRouter ou Anthropic)"
  type        = string
  sensitive   = true
}

variable "llm_api_key_env_name" {
  description = "Nom de la variable d'env attendue par le provider (ex: OPENROUTER_API_KEY, ANTHROPIC_API_KEY)"
  type        = string
  default     = "OPENROUTER_API_KEY"
}

variable "llm_model" {
  description = "Modèle utilisé par Hermes Agent (format provider/modèle si via OpenRouter)"
  type        = string
  default     = "anthropic/claude-sonnet-4.5"
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

# --- Site ------------------------------------------------------------------

variable "site_repo_url" {
  description = "URL du dépôt Git du site web à cloner sur la VM (laisser vide pour ne rien cloner)"
  type        = string
  default     = ""
}
