output "static_ip" {
  description = "IP publique statique de la VM (à pointer avec ton nom de domaine)"
  value       = google_compute_address.static_ip.address
}

output "instance_name" {
  value = google_compute_instance.site_agent.name
}

output "tailscale_ssh_hint" {
  description = "Commande pour se connecter une fois la VM démarrée (~2-3 min après l'apply)"
  value       = "tailscale ssh <ton_user>@${var.instance_name}"
}
