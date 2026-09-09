#!/bin/bash
# ==============================================================================
# Startup script GCP — généré par Terraform (templatefile), exécuté en root
# au premier boot. Tout est non-interactif pour permettre un cycle
# destroy/recreate entièrement automatisé depuis GitHub Actions.
# ==============================================================================
set -euo pipefail
exec > /var/log/startup-script.log 2>&1

echo "=== [1/6] Mise à jour du système ==="
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get upgrade -y
apt-get install -y curl git ufw ca-certificates jq

echo "=== [2/6] Docker ==="
curl -fsSL https://get.docker.com | sh

echo "=== [3/6] Tailscale (SSH activé, hostname fixe) ==="
curl -fsSL https://tailscale.com/install.sh | sh
tailscale up --authkey="${tailscale_authkey}" --ssh --hostname="${instance_name}"

echo "=== [4/6] Pare-feu local ==="
ufw allow in on tailscale0
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 41641/udp
ufw --force enable
# Port 22 volontairement fermé au public (voir aussi la règle firewall GCP
# "deny-ssh-public" côté Terraform) : accès uniquement via Tailscale SSH.

echo "=== [5/6] Utilisateur dédié + Hermes Agent + OpenCode ==="
id -u hermes &>/dev/null || useradd -m -s /bin/bash hermes
usermod -aG docker hermes

su - hermes -c "curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash"
su - hermes -c "curl -fsSL https://opencode.ai/install | bash"

mkdir -p /home/hermes/.hermes
cat > /home/hermes/.hermes/.env <<ENVFILE
${llm_api_key_env_name}=${llm_api_key}
LLM_MODEL=${llm_model}
%{ if discord_bot_token != "" ~}
DISCORD_BOT_TOKEN=${discord_bot_token}
DISCORD_ALLOWED_USERS=${discord_allowed_users}
%{ endif ~}
%{ if telegram_bot_token != "" ~}
TELEGRAM_BOT_TOKEN=${telegram_bot_token}
%{ endif ~}
ENVFILE
chown -R hermes:hermes /home/hermes/.hermes
chmod 600 /home/hermes/.hermes/.env

# La même clé LLM est exposée à OpenCode via le profil shell de l'utilisateur
# hermes (OpenCode détecte automatiquement les variables d'env standard).
echo "export ${llm_api_key_env_name}=${llm_api_key}" >> /home/hermes/.bashrc
chown hermes:hermes /home/hermes/.bashrc

%{ if site_repo_url != "" ~}
echo "=== Clonage du dépôt du site ==="
su - hermes -c "git clone ${site_repo_url} /home/hermes/site"
%{ endif ~}

echo "=== [6/6] Service systemd pour le gateway Hermes (redémarre tout seul) ==="
cat > /etc/systemd/system/hermes-gateway.service <<'UNIT'
[Unit]
Description=Hermes Agent Gateway
After=network.target

[Service]
Type=simple
User=hermes
EnvironmentFile=/home/hermes/.hermes/.env
ExecStart=/home/hermes/.local/bin/hermes gateway
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable --now hermes-gateway

echo "=== Startup script terminé avec succès ==="
