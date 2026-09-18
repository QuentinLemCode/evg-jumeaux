#!/bin/bash
# ==============================================================================
# VM APPLICATIVE — provisionnement au premier boot (Terraform templatefile).
#
# Elle ne fait que servir l'application :
#   cloudflared ──▶ caddy ──▶ app-blue | app-green ──▶ SQLite
#                   sweeper ──▶ même fichier
#
# Pas de Node installé, pas d'agent, pas de clé LLM, pas de jeton GitHub. Rien
# n'est CONSTRUIT ici : la CI publie l'image sur GHCR, cette VM la tire. C'est
# ce qui permet une e2-small pour moins de 50 joueurs.
#
# Journal : /var/log/startup-script.log
# ==============================================================================
set -euo pipefail
exec > /var/log/startup-script.log 2>&1

INGRESS_MODE="${ingress_mode}"
SITE_DOMAIN="${site_domain}"
SITE_DIR=/home/hermes/site

echo "=== [1/7] Système ==="
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get upgrade -y
# python3 : deploy.sh réécrit .env avec. sqlite3 : sauvegarde à chaud.
apt-get install -y curl git ufw ca-certificates jq sqlite3 python3

echo "=== [2/7] Swap ==="
# Pas pour construire (c'est la CI qui construit), mais les migrations et les
# sauvegardes SQLite aiment avoir de la marge sur 2 Go de RAM.
if [ ! -f /swapfile ]; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo "=== [3/7] Docker ==="
curl -fsSL https://get.docker.com | sh

echo "=== [4/7] Tailscale (SSH activé) ==="
# L'accès SSH sert à deux choses et rien d'autre : la CI déploie, et la VM des
# agents lit les logs quand elle diagnostique une erreur.
curl -fsSL https://tailscale.com/install.sh | sh
# --advertise-tags is what makes this machine addressable in the ACL policy:
# a Tailscale SSH rule cannot name a host in src or dst, only tags, users and
# entries from the `hosts` section. The auth key must therefore be created
# WITHOUT tags of its own — a tagged key wins and this flag is then refused.
tailscale up --authkey="${tailscale_authkey}" --ssh \
  --hostname="${instance_name}" --advertise-tags=tag:evg-app

echo "=== [5/7] Pare-feu ==="
ufw default deny incoming
ufw default allow outgoing
ufw allow in on tailscale0
if [ "$INGRESS_MODE" = "public_ip" ]; then
  # En mode tunnel on n'ouvre RIEN : cloudflared établit une connexion
  # sortante. Attention : les ports publiés par Docker contournent ufw, la
  # vraie frontière en mode public_ip est la règle de pare-feu GCP.
  ufw allow 80/tcp
  ufw allow 443/tcp
  ufw allow 443/udp
fi
ufw allow 41641/udp
ufw --force enable

id -u hermes &>/dev/null || useradd -m -s /bin/bash hermes
usermod -aG docker hermes

%{ if site_repo_url != "" ~}
echo "=== [6/7] Application ==="
su - hermes -c "git clone ${site_repo_url} $SITE_DIR"

# --- .env : lu par docker compose (substitution ET env_file de l'app) --------
cat > $SITE_DIR/.env <<APPENV
NODE_ENV=production
DATABASE_PATH=/app/data/evg.db
AUTH_SECRET=${auth_secret}
SEED_PIN_HASHES=${seed_pin_hashes}
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
DEPLOYENV

# --- cloudflared : son propre fichier, pour que le jeton n'entre pas dans
#     l'environnement de l'application ------------------------------------
cat > $SITE_DIR/cloudflared.env <<CFENV
TUNNEL_TOKEN=${tunnel_token}
CFENV

chown hermes:hermes $SITE_DIR/.env $SITE_DIR/deploy.env $SITE_DIR/cloudflared.env
chmod 600 $SITE_DIR/.env $SITE_DIR/deploy.env $SITE_DIR/cloudflared.env

# Two writers share this directory, and they are not the same user:
#   - the container, which runs as `node` = uid 1000 and creates evg.db;
#   - hermes on the host, which takes the pre-migration backup in deploy.sh.
# A bind mount ignores the image's ownership and takes the host's, and
# `useradd` gave hermes whatever uid was free (1000 is usually taken on a GCE
# image), so "chown hermes" alone leaves the container unable to write at all.
# Owner 1000 with hermes' group and g+s gives both of them write access and
# keeps the group on anything created later.
mkdir -p $SITE_DIR/data/backups $SITE_DIR/data/deploy
chown -R 1000:"$(id -g hermes)" $SITE_DIR/data
chmod -R 2775 $SITE_DIR/data

echo "--- GHCR + premier déploiement ---"
su - hermes -c "echo '${ghcr_token}' | docker login ghcr.io -u '${ghcr_username}' --password-stdin"
su - hermes -c "cd $SITE_DIR && docker compose up -d caddy"
%{ if ingress_mode == "tunnel" ~}
su - hermes -c "cd $SITE_DIR && docker compose --profile tunnel up -d cloudflared"
%{ endif ~}
su - hermes -c "cd $SITE_DIR && scripts/agent/deploy.sh --tag '${image_tag}' --commit bootstrap" || \
  echo "WARN: premier déploiement échoué — voir 'scripts/agent/deploy.sh --status'"

# Le seed refuse de tourner si le roster utilise encore le PIN de
# développement : c'est volontaire (spec 0002).
su - hermes -c "cd $SITE_DIR && docker compose --profile tunnel --profile blue run --rm --no-deps app-blue npm run db:seed" || \
  echo "WARN: seed refusé (PIN de développement ?) — relancer après avoir mis les vrais PIN"
%{ else ~}
echo "=== [6/7] Pas de site_repo_url : application non déployée ==="
%{ endif ~}

echo "=== [7/7] Service systemd ==="
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

systemctl daemon-reload
%{ if site_repo_url != "" ~}
systemctl enable evg-app
%{ endif ~}

echo "=== Terminé ==="
echo "Site    : https://$SITE_DOMAIN"
echo "Ingress : $INGRESS_MODE"
echo "SSH     : tailscale ssh hermes@${instance_name}"
