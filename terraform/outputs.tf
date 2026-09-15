output "site_url" {
  description = "L'adresse publique du site, une fois le DNS propagé (quelques secondes)"
  value       = "https://${local.site_fqdn}"
}

output "ingress_mode" {
  description = "tunnel (aucun port entrant) ou public_ip (80/443 ouverts aux IP Cloudflare)"
  value       = var.ingress_mode
}

output "static_ip" {
  description = <<-EOT
    IP publique de la VM. En mode tunnel elle ne sert qu'à la SORTIE : rien
    n'écoute dessus et aucun port entrant n'est ouvert.
  EOT
  value       = google_compute_address.static_ip.address
}

output "instance_name" {
  value = google_compute_instance.site_agent.name
}

output "tunnel_id" {
  description = "ID du tunnel Cloudflare, vide en mode public_ip"
  value       = local.use_tunnel ? cloudflare_zero_trust_tunnel_cloudflared.site[0].id : ""
}

output "tailscale_ssh_hint" {
  description = "Commande pour se connecter une fois la VM démarrée (~3-4 min après l'apply)"
  value       = "tailscale ssh hermes@${var.instance_name}"
}

output "health_url" {
  description = "À interroger après un déploiement : doit renvoyer le SHA déployé"
  value       = "https://${local.site_fqdn}/api/health"
}
