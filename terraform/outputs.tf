output "site_url" {
  description = "L'adresse publique du site, une fois le DNS propagé (quelques secondes)"
  value       = "https://${local.site_fqdn}"
}

output "health_url" {
  description = "À interroger après un déploiement : doit renvoyer le SHA déployé"
  value       = "https://${local.site_fqdn}/api/health"
}

output "ingress_mode" {
  description = "tunnel (aucun port entrant) ou public_ip (80/443 ouverts aux IP Cloudflare)"
  value       = var.ingress_mode
}

output "app_vm" {
  description = "La VM applicative. C'est l'hôte auquel la CI se connecte pour déployer."
  value = {
    name         = google_compute_instance.app.name
    machine_type = var.app_machine_type
    static_ip    = google_compute_address.static_ip.address
    ssh          = "tailscale ssh hermes@${google_compute_instance.app.name}"
  }
}

output "agents_vm" {
  description = "La VM des agents. Aucun secret applicatif, aucun port entrant."
  value = {
    name         = google_compute_instance.agents.name
    machine_type = var.machine_type
    ssh          = "tailscale ssh hermes@${google_compute_instance.agents.name}"
  }
}

output "github_variables_to_set" {
  description = "À reporter dans les Variables du dépôt GitHub pour que le déploiement trouve la bonne VM"
  value = {
    APP_VM_HOSTNAME    = google_compute_instance.app.name
    AGENTS_VM_HOSTNAME = google_compute_instance.agents.name
    SITE_SUBDOMAIN     = var.site_subdomain
  }
}

output "tunnel_id" {
  description = "ID du tunnel Cloudflare, vide en mode public_ip"
  value       = local.use_tunnel ? cloudflare_zero_trust_tunnel_cloudflared.site[0].id : ""
}
