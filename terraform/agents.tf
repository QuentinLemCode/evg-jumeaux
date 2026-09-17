# ==============================================================================
# La VM des agents. Hermes, l'agent de spec, l'agent de code, et la
# surveillance de l'application.
#
# Elle ne sert rien au public et ne détient aucun secret applicatif. Elle a
# besoin de : Node 26, git, gh, OpenCode, Claude Code, une clé LLM et un jeton
# GitHub — plus un accès Tailscale à la VM applicative, en lecture, pour lire
# ses logs quand elle diagnostique une erreur.
#
# La surveillance tourne ICI et pas sur la VM applicative, délibérément : un
# watcher installé sur la machine qu'il surveille ne peut pas signaler que
# cette machine est morte.
# ==============================================================================

resource "google_compute_instance" "agents" {
  name         = var.instance_name
  machine_type = var.machine_type
  zone         = var.zone
  tags         = [var.instance_name]

  boot_disk {
    initialize_params {
      image = "debian-cloud/debian-12"
      size  = var.disk_size_gb
      type  = "pd-standard"
    }
  }

  network_interface {
    network = "default"
    # IP externe pour la SORTIE uniquement (GitHub, le provider LLM, apt).
    # Aucun port entrant n'est ouvert vers cette VM.
    access_config {}
  }

  metadata = {
    startup-script = templatefile("${path.module}/templates/startup-agents.sh.tpl", {
      instance_name          = var.instance_name
      app_instance_name      = var.app_instance_name
      tailscale_authkey      = var.tailscale_authkey
      llm_provider           = var.llm_provider
      llm_api_key            = var.llm_api_key
      llm_api_key_env_name   = var.llm_api_key_env_name
      llm_base_url           = var.llm_base_url
      llm_model              = var.llm_model
      github_token           = var.github_token
      git_author_name        = var.git_author_name
      git_author_email       = var.git_author_email
      discord_bot_token      = var.discord_bot_token
      discord_allowed_users  = var.discord_allowed_users
      discord_webhook_url    = var.discord_webhook_url
      telegram_bot_token     = var.telegram_bot_token
      telegram_allowed_users = var.telegram_allowed_users
      telegram_chat_id       = var.telegram_chat_id
      site_repo_url          = var.site_repo_url
      site_domain            = local.site_fqdn
    })
  }

  allow_stopping_for_update = true
}
