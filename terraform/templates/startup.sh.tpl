#!/bin/bash
# ==============================================================================
# Startup script GCP — généré par Terraform (templatefile), exécuté en root au
# premier boot. Tout est non-interactif pour permettre un cycle
# destroy/recreate entièrement automatisé depuis GitHub Actions.
#
#   1. la machine        (Docker, Tailscale SSH, pare-feu, swap)
#   2. les agents        (OpenCode + Claude Code + la passerelle Hermes)
#   3. l'application     (image tirée de GHCR, jamais construite ici)
#   4. la surveillance   (alerte en cas d'erreur, avec diagnostic court)
#
# Rien n'est CONSTRUIT sur cette VM : la CI publie l'image sur GHCR, la VM la
# tire. C'est ce qui supprime le risque d'OOM sur une machine à 4 Go et rend un
# déploiement aussi rapide qu'un `docker pull`.
#
# Journal : /var/log/startup-script.log
# ==============================================================================
set -euo pipefail
exec > /var/log/startup-script.log 2>&1

INGRESS_MODE="${ingress_mode}"
SITE_DOMAIN="${site_domain}"
SITE_DIR=/home/hermes/site

echo "=== [1/9] Système ==="
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get upgrade -y
apt-get install -y curl git ufw ca-certificates jq sqlite3 python3

echo "=== [2/9] Swap ==="
# Plus nécessaire pour construire l'image (c'est la CI qui construit), mais les
# migrations et les sauvegardes SQLite aiment avoir de la marge.
if [ ! -f /swapfile ]; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo "=== [3/9] Docker ==="
curl -fsSL https://get.docker.com | sh

echo "=== [4/9] Tailscale (SSH activé, hostname fixe) ==="
curl -fsSL https://tailscale.com/install.sh | sh
tailscale up --authkey="${tailscale_authkey}" --ssh --hostname="${instance_name}"

echo "=== [5/9] Pare-feu local ==="
ufw default deny incoming
ufw default allow outgoing
ufw allow in on tailscale0
if [ "$INGRESS_MODE" = "public_ip" ]; then
  # En mode tunnel on n'ouvre RIEN : cloudflared établit une connexion
  # sortante. Attention : les ports publiés par Docker contournent ufw, la
  # vraie frontière en mode public_ip est la règle de pare-feu GCP qui
  # n'autorise que les plages Cloudflare.
  ufw allow 80/tcp
  ufw allow 443/tcp
  ufw allow 443/udp
fi
ufw allow 41641/udp
ufw --force enable

echo "=== [6/9] Utilisateur, Node, agents ==="
id -u hermes &>/dev/null || useradd -m -s /bin/bash hermes
usermod -aG docker hermes

curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs

su - hermes -c "curl -fsSL https://opencode.ai/install | bash"
su - hermes -c "curl -fsSL https://claude.ai/install.sh | bash" || \
  echo "WARN: installation de Claude Code échouée — OpenCode reste disponible"

# La clé Agent Platform, exposée sous LES DEUX noms attendus par les SDK
# Google : le nom exact dépend de la version du SDK, et se tromper ne produit
# qu'un « pas de clé » silencieux.
mkdir -p /home/hermes/.hermes
cat > /home/hermes/.hermes/.env <<ENVFILE
${llm_api_key_env_name}=${llm_api_key}
GEMINI_API_KEY=${llm_api_key}
GOOGLE_GENERATIVE_AI_API_KEY=${llm_api_key}
LLM_MODEL=${llm_model}
LLM_PROVIDER=${llm_provider}
AGENT_RUNTIME=opencode
%{ if llm_base_url != "" ~}
LLM_BASE_URL=${llm_base_url}
%{ endif ~}
%{ if discord_bot_token != "" ~}
DISCORD_BOT_TOKEN=${discord_bot_token}
DISCORD_ALLOWED_USERS=${discord_allowed_users}
%{ endif ~}
%{ if telegram_bot_token != "" ~}
TELEGRAM_BOT_TOKEN=${telegram_bot_token}
TELEGRAM_ALLOWED_USERS=${telegram_allowed_users}
%{ endif ~}
ENVFILE
chown -R hermes:hermes /home/hermes/.hermes
chmod 600 /home/hermes/.hermes/.env

# Config OpenCode globale : le modèle et, si la clé passe par un endpoint
# dédié, son URL de base. Le dépôt ne porte que les agents et le modèle par
# variable, pour qu'il reste utilisable ailleurs.
mkdir -p /home/hermes/.config/opencode
cat > /home/hermes/.config/opencode/opencode.json <<OCJSON
{
  "\$schema": "https://opencode.ai/config.json",
  "model": "${llm_model}",
  "provider": {
    "${llm_provider}": {
      "options": {
        "apiKey": "{env:${llm_api_key_env_name}}"
%{ if llm_base_url != "" ~}
        , "baseURL": "${llm_base_url}"
%{ endif ~}
      }
    }
  }
}
OCJSON
chown -R hermes:hermes /home/hermes/.config

# Les agents lisent la clé depuis le profil shell aussi (opencode run est
# lancé par les scripts, pas par systemd).
cat >> /home/hermes/.bashrc <<'BASHRC'
set -a
[ -f /home/hermes/.hermes/.env ] && . /home/hermes/.hermes/.env
set +a
export AGENT_RUNTIME=opencode
BASHRC
chown hermes:hermes /home/hermes/.bashrc

%{ if site_repo_url != "" ~}
echo "=== [7/9] Application ==="
su - hermes -c "git clone ${site_repo_url} $SITE_DIR"

# --- .env : lu par docker compose (substitution ET env_file de l'app) --------
cat > $SITE_DIR/.env <<APPENV
NODE_ENV=production
DATABASE_PATH=/app/data/evg.db
AUTH_SECRET=${auth_secret}
SITE_DOMAIN=$SITE_DOMAIN
HEALTH_URL=https://$SITE_DOMAIN/api/health
%{ if vapid_public_key != "" ~}
NEXT_PUBLIC_VAPID_PUBLIC_KEY=${vapid_public_key}
VAPID_PRIVATE_KEY=${vapid_private_key}
VAPID_SUBJECT=${vapid_subject}
%{ endif ~}
IMAGE_REPOSITORY=${image_repository}
IMAGE_TAG=${image_tag}
GIT_COMMIT=bootstrap
APPENV

if [ "$INGRESS_MODE" = "public_ip" ]; then
  cat >> $SITE_DIR/.env <<APPENV2
COMPOSE_FILE=docker-compose.yml:docker-compose.public.yml
COMPOSE_PROFILES=public,blue
CADDY_SITE_ADDRESS=$SITE_DOMAIN
APPENV2
else
  cat >> $SITE_DIR/.env <<'APPENV3'
COMPOSE_FILE=docker-compose.yml
COMPOSE_PROFILES=tunnel,blue
CADDY_SITE_ADDRESS=:8080
APPENV3
fi

# --- deploy.env : jamais passé aux conteneurs -------------------------------
cat > $SITE_DIR/deploy.env <<DEPLOYENV
GHCR_USERNAME=${ghcr_username}
GHCR_TOKEN=${ghcr_token}
%{ if discord_webhook_url != "" ~}
DISCORD_WEBHOOK_URL=${discord_webhook_url}
%{ endif ~}
%{ if telegram_bot_token != "" ~}
TELEGRAM_BOT_TOKEN=${telegram_bot_token}
TELEGRAM_CHAT_ID=${telegram_chat_id}
%{ endif ~}
DEPLOYENV

# --- cloudflared : son propre fichier, pour que le jeton n'entre pas dans
#     l'environnement de l'application ------------------------------------
cat > $SITE_DIR/cloudflared.env <<CFENV
TUNNEL_TOKEN=${tunnel_token}
CFENV

chown hermes:hermes $SITE_DIR/.env $SITE_DIR/deploy.env $SITE_DIR/cloudflared.env
chmod 600 $SITE_DIR/.env $SITE_DIR/deploy.env $SITE_DIR/cloudflared.env

mkdir -p $SITE_DIR/data/backups
chown -R hermes:hermes $SITE_DIR/data

echo "--- GHCR + premier déploiement ---"
su - hermes -c "echo '${ghcr_token}' | docker login ghcr.io -u '${ghcr_username}' --password-stdin"
su - hermes -c "cd $SITE_DIR && docker compose up -d caddy"
%{ if ingress_mode == "tunnel" ~}
su - hermes -c "cd $SITE_DIR && docker compose --profile tunnel up -d cloudflared"
%{ endif ~}
su - hermes -c "cd $SITE_DIR && scripts/agent/deploy.sh --tag '${image_tag}' --commit bootstrap" || \
  echo "WARN: premier déploiement échoué — voir 'scripts/agent/deploy.sh --status' sur la VM"

# Le seed refuse de tourner si le roster utilise encore le PIN de
# développement : c'est volontaire (spec 0002).
su - hermes -c "cd $SITE_DIR && docker compose --profile tunnel --profile blue run --rm --no-deps app-blue npm run db:seed" || \
  echo "WARN: seed refusé (PIN de développement ?) — relancer après avoir mis les vrais PIN"
%{ else ~}
echo "=== [7/9] Pas de site_repo_url : application non déployée ==="
%{ endif ~}

echo "=== [8/9] Services systemd ==="
cat > /etc/systemd/system/hermes-gateway.service <<'UNIT'
[Unit]
Description=Hermes Agent Gateway (orchestrateur du pipeline spec-driven)
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=simple
User=hermes
WorkingDirectory=/home/hermes/site
EnvironmentFile=/home/hermes/.hermes/.env
ExecStart=/home/hermes/.local/bin/hermes gateway
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT

# Remonte la stack au reboot, dans la couleur enregistrée par le dernier
# déploiement (COMPOSE_PROFILES est réécrit dans .env par deploy.sh).
cat > /etc/systemd/system/evg-app.service <<'UNIT'
[Unit]
Description=EVG app (docker compose)
Requires=docker.service
After=docker.service network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
User=hermes
WorkingDirectory=/home/hermes/site
ExecStart=/usr/bin/docker compose up -d
ExecStop=/usr/bin/docker compose stop

[Install]
WantedBy=multi-user.target
UNIT

# Surveillance : santé, erreurs dans les logs, disque. Alerte dédupliquée avec
# un diagnostic court (scripts/agent/watch-errors.sh).
cat > /etc/systemd/system/evg-watch-errors.service <<'UNIT'
[Unit]
Description=EVG — surveillance des erreurs applicatives
After=docker.service

[Service]
Type=oneshot
User=hermes
WorkingDirectory=/home/hermes/site
ExecStart=/home/hermes/site/scripts/agent/watch-errors.sh
UNIT

cat > /etc/systemd/system/evg-watch-errors.timer <<'UNIT'
[Unit]
Description=EVG — surveillance des erreurs toutes les 2 minutes

[Timer]
OnBootSec=3min
OnUnitActiveSec=2min
AccuracySec=15s

[Install]
WantedBy=timers.target
UNIT

systemctl daemon-reload
systemctl enable --now hermes-gateway || echo "WARN: hermes-gateway n'a pas démarré"
%{ if site_repo_url != "" ~}
systemctl enable evg-app
systemctl enable --now evg-watch-errors.timer
%{ endif ~}

echo "=== [9/9] Terminé ==="
echo "Site      : https://$SITE_DOMAIN"
echo "Ingress   : $INGRESS_MODE"
echo "SSH       : tailscale ssh hermes@${instance_name}"
