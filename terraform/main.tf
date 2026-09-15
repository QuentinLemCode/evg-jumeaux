# --- IP statique --------------------------------------------------------------
#
# En mode "tunnel" elle ne sert QU'À LA SORTIE (apt, Docker Hub, GHCR,
# Tailscale, Cloudflare). Rien n'écoute dessus et le pare-feu n'ouvre aucun
# port entrant. Une VM sans IP externe exigerait un Cloud NAT, ce qui est plus
# d'infrastructure pour le même résultat.

resource "google_compute_address" "static_ip" {
  name   = "${var.instance_name}-ip"
  region = var.region
}

# --- Pare-feu -----------------------------------------------------------------

# Ouvert uniquement en mode "public_ip", et seulement aux plages d'IP de
# Cloudflare : sans cette restriction, le proxy Cloudflare masque l'IP
# d'origine dans le DNS mais n'importe qui connaissant l'IP peut contourner le
# proxy en tapant directement la VM.
resource "google_compute_firewall" "allow_http" {
  count   = local.use_tunnel ? 0 : 1
  name    = "${var.instance_name}-allow-http"
  network = "default"

  allow {
    protocol = "tcp"
    ports    = ["80", "443"]
  }

  target_tags   = [var.instance_name]
  source_ranges = var.cloudflare_ingress_cidrs
  description   = "HTTP/HTTPS depuis Cloudflare uniquement"
}

# --- Firewall : bloque explicitement le SSH public ------------------------
# Priorité plus basse (= plus prioritaire) que la règle "default-allow-ssh"
# créée par défaut par GCP, pour garantir que le port 22 reste fermé même
# si cette dernière existe encore sur le projet. L'accès SSH se fait
# uniquement via Tailscale SSH (voir startup script).

resource "google_compute_firewall" "deny_ssh_public" {
  name      = "${var.instance_name}-deny-ssh-public"
  network   = "default"
  priority  = 1000
  direction = "INGRESS"

  deny {
    protocol = "tcp"
    ports    = ["22"]
  }

  source_ranges = ["0.0.0.0/0"]
}

# --- Jeton du connecteur du tunnel -------------------------------------------
#
# Construit ici plutôt que lu sur la ressource : le format du jeton
# (base64 de {"a": account, "t": tunnel, "s": secret}) est documenté et
# stable, alors que le nom de l'attribut a déjà changé entre deux majeures du
# provider. Une chose de moins à casser lors d'une montée de version.

locals {
  tunnel_token = local.use_tunnel ? base64encode(jsonencode({
    a = var.cloudflare_account_id
    t = cloudflare_zero_trust_tunnel_cloudflared.site[0].id
    s = base64encode(random_password.tunnel_secret[0].result)
  })) : ""
}

# --- VM --------------------------------------------------------------------

resource "google_compute_instance" "site_agent" {
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
    access_config {
      nat_ip = google_compute_address.static_ip.address
    }
  }

  metadata = {
    startup-script = templatefile("${path.module}/templates/startup.sh.tpl", {
      instance_name          = var.instance_name
      tailscale_authkey      = var.tailscale_authkey
      llm_provider           = var.llm_provider
      llm_api_key            = var.llm_api_key
      llm_api_key_env_name   = var.llm_api_key_env_name
      llm_base_url           = var.llm_base_url
      llm_model              = var.llm_model
      discord_bot_token      = var.discord_bot_token
      discord_allowed_users  = var.discord_allowed_users
      discord_webhook_url    = var.discord_webhook_url
      telegram_bot_token     = var.telegram_bot_token
      telegram_allowed_users = var.telegram_allowed_users
      telegram_chat_id       = var.telegram_chat_id
      site_repo_url          = var.site_repo_url
      site_domain            = local.site_fqdn
      ingress_mode           = var.ingress_mode
      tunnel_token           = local.tunnel_token
      auth_secret            = var.auth_secret
      vapid_public_key       = var.vapid_public_key
      vapid_private_key      = var.vapid_private_key
      vapid_subject          = var.vapid_subject
      image_repository       = var.image_repository
      image_tag              = var.image_tag
      ghcr_username          = var.ghcr_username
      ghcr_token             = var.ghcr_token
    })
  }

  # Pas de clé SSH classique : accès uniquement via Tailscale SSH (voir metadata ci-dessus)
  allow_stopping_for_update = true
}
