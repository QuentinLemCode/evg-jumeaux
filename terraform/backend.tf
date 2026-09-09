terraform {
  required_version = ">= 1.6"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
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
