# ==============================================================================
# Deux VM, séparées volontairement.
#
#   evg-app          l'application. Petite (e2-small) : moins de 50 joueurs et
#                    plus rien n'est construit dessus. Aucun port entrant.
#   evg-site-agent   les agents (Hermes, spec, code) et la surveillance.
#
# Pourquoi séparer : un agent qui lance `npm ci` et un build occupe le CPU et
# la RAM pendant plusieurs minutes. Sur une machine partagée, ça se voit sur le
# temps de réponse de l'app — pendant la soirée, au moment où elle sert.
#
# La VM des agents ne détient AUCUN secret applicatif (ni AUTH_SECRET, ni clés
# VAPID, ni jeton de tunnel) et la VM applicative ne détient aucune clé LLM ni
# jeton GitHub. Chacune ne porte que ce dont elle a besoin.
# ==============================================================================

# --- IP statique (VM applicative) --------------------------------------------
#
# En mode "tunnel" elle ne sert QU'À LA SORTIE (apt, GHCR, Tailscale,
# Cloudflare). Rien n'écoute dessus et le pare-feu n'ouvre aucun port entrant.
resource "google_compute_address" "static_ip" {
  name   = "${var.app_instance_name}-ip"
  region = var.region
}

# --- Pare-feu ----------------------------------------------------------------

# Ouvert uniquement en mode "public_ip", et seulement aux plages d'IP de
# Cloudflare : sans cette restriction, le proxy Cloudflare masque l'IP
# d'origine dans le DNS mais n'importe qui connaissant l'IP contourne le
# proxy en tapant directement la VM.
resource "google_compute_firewall" "allow_http" {
  count   = local.use_tunnel ? 0 : 1
  name    = "${var.app_instance_name}-allow-http"
  network = "default"

  allow {
    protocol = "tcp"
    ports    = ["80", "443"]
  }

  target_tags   = [var.app_instance_name]
  source_ranges = var.cloudflare_ingress_cidrs
  description   = "HTTP/HTTPS depuis Cloudflare uniquement, vers la VM applicative"
}

# Priorité plus basse (= plus prioritaire) que la règle "default-allow-ssh"
# créée par défaut par GCP, pour garantir que le port 22 reste fermé sur LES
# DEUX VM même si cette dernière existe encore sur le projet. L'accès SSH se
# fait uniquement via Tailscale SSH.
resource "google_compute_firewall" "deny_ssh_public" {
  name      = "evg-deny-ssh-public"
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
