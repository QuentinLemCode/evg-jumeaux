terraform {
  # >= 1.16 and not >= 1.6: `terraform fmt` changed its alignment rules
  # between those, so an older local version reformats every file and the CI
  # fmt check starts failing on work that looked clean locally.
  required_version = ">= 1.16"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
    cloudflare = {
      source = "cloudflare/cloudflare"
      # Pinned to the v5 major on purpose: v5 renamed a lot of resources
      # (cloudflare_record -> cloudflare_dns_record, cloudflare_tunnel ->
      # cloudflare_zero_trust_tunnel_cloudflared). An unpinned provider would
      # break this module on the next major.
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # Config volontairement vide (backend config "partielle") : le bucket, le
  # prefix, etc. sont fournis à `terraform init` via -backend-config, depuis
  # les workflows GitHub Actions. Ça évite de committer le nom du bucket ici
  # et permet de réutiliser ce repo pour plusieurs environnements si besoin.
  backend "gcs" {}
}

provider "google" {
  project = var.project_id
  region  = var.region
  zone    = var.zone
}

provider "cloudflare" {
  api_token = var.cloudflare_api_token
}
