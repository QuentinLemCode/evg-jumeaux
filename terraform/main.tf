# --- IP statique --------------------------------------------------------------

resource "google_compute_address" "static_ip" {
  name   = "${var.instance_name}-ip"
  region = var.region
}

# --- Firewall : autorise le site web ------------------------------------------

resource "google_compute_firewall" "allow_http" {
  name    = "${var.instance_name}-allow-http"
  network = "default"

  allow {
    protocol = "tcp"
    ports    = ["80", "443"]
  }

  target_tags   = [var.instance_name]
  source_ranges = ["0.0.0.0/0"]
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
      instance_name         = var.instance_name
      tailscale_authkey     = var.tailscale_authkey
      llm_api_key           = var.llm_api_key
      llm_api_key_env_name  = var.llm_api_key_env_name
      llm_model             = var.llm_model
      discord_bot_token     = var.discord_bot_token
      discord_allowed_users = var.discord_allowed_users
      telegram_bot_token    = var.telegram_bot_token
      site_repo_url         = var.site_repo_url
    })
  }

  # Pas de clé SSH classique : accès uniquement via Tailscale SSH (voir metadata ci-dessus)
  allow_stopping_for_update = true
}
