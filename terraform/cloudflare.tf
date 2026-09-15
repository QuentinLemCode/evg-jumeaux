# ==============================================================================
# Cloudflare : DNS + ingress
#
# Deux modes, choisis par var.ingress_mode :
#
#   "tunnel" (défaut, recommandé)
#     Un tunnel Cloudflare. `cloudflared` tourne sur la VM et ouvre une
#     connexion SORTANTE vers Cloudflare ; aucun port entrant n'est ouvert,
#     l'IP d'origine n'est jamais exposée, et Cloudflare termine le TLS —
#     donc pas de certificat à gérer sur la VM. Le DNS est un CNAME vers
#     <tunnel-id>.cfargotunnel.com, forcément proxifié.
#
#   "public_ip"
#     Un enregistrement A vers l'IP statique, proxifié, avec le pare-feu
#     restreint aux plages d'IP de Cloudflare. Gardé comme repli : ça marche,
#     mais ça expose un port et oblige à gérer un certificat d'origine.
# ==============================================================================

locals {
  use_tunnel = var.ingress_mode == "tunnel"
  site_fqdn  = "${var.site_subdomain}.${var.domain}"
}

# --- Tunnel -------------------------------------------------------------------

resource "random_password" "tunnel_secret" {
  count   = local.use_tunnel ? 1 : 0
  length  = 64
  special = false
}

resource "cloudflare_zero_trust_tunnel_cloudflared" "site" {
  count      = local.use_tunnel ? 1 : 0
  account_id = var.cloudflare_account_id
  name       = var.instance_name
  # Managed from the Cloudflare side so the ingress rules below are the single
  # source of truth; the VM only needs the connector token.
  config_src    = "cloudflare"
  tunnel_secret = base64encode(random_password.tunnel_secret[0].result)
}

resource "cloudflare_zero_trust_tunnel_cloudflared_config" "site" {
  count      = local.use_tunnel ? 1 : 0
  account_id = var.cloudflare_account_id
  tunnel_id  = cloudflare_zero_trust_tunnel_cloudflared.site[0].id

  config = {
    ingress = [
      {
        hostname = local.site_fqdn
        # Caddy inside the compose network. It is not doing TLS here — the
        # tunnel already did — it is the graceful reverse proxy that lets a
        # blue/green switch happen without dropping a connection.
        service = "http://caddy:8080"
      },
      # Cloudflare requires a catch-all rule last.
      {
        service = "http_status:404"
      },
    ]
  }
}

resource "cloudflare_dns_record" "site_tunnel" {
  count   = local.use_tunnel ? 1 : 0
  zone_id = var.cloudflare_zone_id
  name    = local.site_fqdn
  type    = "CNAME"
  content = "${cloudflare_zero_trust_tunnel_cloudflared.site[0].id}.cfargotunnel.com"
  # A tunnel record is always proxied; it has no meaning otherwise.
  proxied = true
  ttl     = 1
  comment = "evg-jumeaux — managed by Terraform (tunnel ingress)"
}

# --- Public IP (repli) --------------------------------------------------------

resource "cloudflare_dns_record" "site_public" {
  count   = local.use_tunnel ? 0 : 1
  zone_id = var.cloudflare_zone_id
  name    = local.site_fqdn
  type    = "A"
  content = google_compute_address.static_ip.address
  # The proxy is the point: it hides the origin IP and puts Cloudflare's WAF
  # and rate limiting in front of the app.
  proxied = true
  ttl     = 1
  comment = "evg-jumeaux — managed by Terraform (public-ip ingress)"
}
