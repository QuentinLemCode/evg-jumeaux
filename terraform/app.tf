# ==============================================================================
# La VM applicative. Elle ne fait que servir l'app :
#
#   cloudflared ──▶ caddy ──▶ app-blue | app-green ──▶ SQLite
#                   sweeper ──▶ même fichier
#
# Pas de Node installé, pas d'agent, pas de clé LLM. L'image vient de GHCR,
# construite par la CI ; le déploiement est un `docker pull` suivi d'un
# rechargement gracieux de Caddy.
# ==============================================================================

resource "google_compute_instance" "app" {
  name         = var.app_instance_name
  machine_type = var.app_machine_type
  zone         = var.zone
  tags         = [var.app_instance_name]

  boot_disk {
    initialize_params {
      image = "debian-cloud/debian-12"
      size  = var.app_disk_size_gb
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
    startup-script = templatefile("${path.module}/templates/startup-app.sh.tpl", {
      instance_name     = var.app_instance_name
      tailscale_authkey = var.tailscale_authkey
      site_repo_url     = var.site_repo_url
      site_domain       = local.site_fqdn
      ingress_mode      = var.ingress_mode
      tunnel_token      = local.tunnel_token
      auth_secret       = var.auth_secret
      vapid_public_key  = var.vapid_public_key
      vapid_private_key = var.vapid_private_key
      vapid_subject     = var.vapid_subject
      image_repository  = var.image_repository
      image_tag         = var.image_tag
      ghcr_username     = var.ghcr_username
      ghcr_token        = var.ghcr_token
    })
  }

  # Pas de clé SSH classique : accès uniquement via Tailscale SSH.
  allow_stopping_for_update = true
}
