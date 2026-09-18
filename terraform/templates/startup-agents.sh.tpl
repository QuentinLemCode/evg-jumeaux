#!/bin/bash
# ==============================================================================
# VM DES AGENTS — provisionnement au premier boot (Terraform templatefile).
#
#   Hermes (passerelle Discord/Telegram)
#   agent de spec / de code / de revue / de diagnostic  (OpenCode)
#   surveillance de l'application, DEPUIS L'EXTÉRIEUR
#
# Elle ne sert rien au public et ne détient aucun secret applicatif : ni
# AUTH_SECRET, ni clé VAPID, ni jeton de tunnel. L'agent de code ne pousse
# jamais sur main — il ouvre une pull request et la protection de branche
# décide.
#
# Journal : /var/log/startup-script.log
# ==============================================================================
set -euo pipefail
exec > /var/log/startup-script.log 2>&1

SITE_DIR=/home/hermes/site
APP_HOST="${app_instance_name}"
SITE_DOMAIN="${site_domain}"

echo "=== [1/8] Système ==="
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get upgrade -y
apt-get install -y curl git ufw ca-certificates jq python3

echo "=== [2/8] Swap ==="
# Le gate (`npm ci` + `next build` + les tests) tient large sur 4 Go, mais deux
# agents en parallèle frôlent la limite. 2 Go de swap transforment un OOM kill
# silencieux en build simplement plus lent.
if [ ! -f /swapfile ]; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo "=== [3/8] Tailscale (SSH activé) ==="
curl -fsSL https://tailscale.com/install.sh | sh
# --advertise-tags is what makes this machine addressable in the ACL policy:
# a Tailscale SSH rule cannot name a host in src or dst, only tags, users and
# entries from the `hosts` section. The auth key must therefore be created
# WITHOUT tags of its own — a tagged key wins and this flag is then refused.
tailscale up --authkey="${tailscale_authkey}" --ssh \
  --hostname="${instance_name}" --advertise-tags=tag:evg-agents

echo "=== [4/8] Pare-feu ==="
# Aucun port entrant : cette VM ne sert rien. Tout entre par le tailnet.
ufw default deny incoming
ufw default allow outgoing
ufw allow in on tailscale0
ufw allow 41641/udp
ufw --force enable

echo "=== [5/8] Node 26 et GitHub CLI ==="
id -u hermes &>/dev/null || useradd -m -s /bin/bash hermes

# Même majeure que .nvmrc et que l'image applicative.
curl -fsSL https://deb.nodesource.com/setup_26.x | bash -
apt-get install -y nodejs

# gh : c'est par lui que l'agent de code ouvre ses pull requests.
mkdir -p -m 755 /etc/apt/keyrings
curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
  | tee /etc/apt/keyrings/githubcli-archive-keyring.gpg > /dev/null
chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
  > /etc/apt/sources.list.d/github-cli.list
apt-get update -y
apt-get install -y gh

echo "=== [6/8] Agents ==="
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

# GitHub : pousser une branche, ouvrir une PR, activer l'auto-merge. Pas le
# droit d'administrer le dépôt, donc pas le droit de lever la protection de
# branche qui l'empêche de casser main.
GH_TOKEN=${github_token}

# Surveillance : l'app est sur une AUTRE VM, donc on la regarde de l'extérieur.
APP_HOST=$APP_HOST
SITE_DOMAIN=$SITE_DOMAIN
HEALTH_URL=https://$SITE_DOMAIN/api/health
%{ if discord_bot_token != "" ~}
DISCORD_BOT_TOKEN=${discord_bot_token}
DISCORD_ALLOWED_USERS=${discord_allowed_users}
%{ endif ~}
%{ if discord_webhook_url != "" ~}
DISCORD_WEBHOOK_URL=${discord_webhook_url}
%{ endif ~}
%{ if telegram_bot_token != "" ~}
TELEGRAM_BOT_TOKEN=${telegram_bot_token}
TELEGRAM_ALLOWED_USERS=${telegram_allowed_users}
TELEGRAM_CHAT_ID=${telegram_chat_id}
%{ endif ~}
ENVFILE
chown -R hermes:hermes /home/hermes/.hermes
chmod 600 /home/hermes/.hermes/.env

# Config OpenCode globale : le modèle et, si la clé passe par un endpoint
# dédié, son URL de base.
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

cat >> /home/hermes/.bashrc <<'BASHRC'
set -a
[ -f /home/hermes/.hermes/.env ] && . /home/hermes/.hermes/.env
set +a
export AGENT_RUNTIME=opencode
BASHRC
chown hermes:hermes /home/hermes/.bashrc

%{ if site_repo_url != "" ~}
echo "=== [7/8] Dépôt de travail ==="
su - hermes -c "git clone ${site_repo_url} $SITE_DIR"
su - hermes -c "cd $SITE_DIR && git config user.name '${git_author_name}'"
su - hermes -c "cd $SITE_DIR && git config user.email '${git_author_email}'"
# Pousser une branche courante par défaut, jamais main : l'agent crée
# explicitement sa branche, ceci n'est qu'une ceinture de plus.
su - hermes -c "cd $SITE_DIR && git config push.default current"
su - hermes -c "cd $SITE_DIR && npm ci" || echo "WARN: npm ci a échoué — relancer sur la VM"
%{ else ~}
echo "=== [7/8] Pas de site_repo_url : dépôt non cloné ==="
%{ endif ~}

echo "=== [8/8] Services systemd ==="
cat > /etc/systemd/system/hermes-gateway.service <<'UNIT'
[Unit]
Description=Hermes Agent Gateway (orchestrateur du pipeline spec-driven)
After=network-online.target
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

# Surveillance de l'application, depuis cette VM : un watcher installé sur la
# machine qu'il surveille ne peut pas signaler que cette machine est morte.
cat > /etc/systemd/system/evg-watch-errors.service <<'UNIT'
[Unit]
Description=EVG — surveillance de l'application (depuis la VM des agents)
After=network-online.target

[Service]
Type=oneshot
User=hermes
WorkingDirectory=/home/hermes/site
EnvironmentFile=/home/hermes/.hermes/.env
ExecStart=/home/hermes/site/scripts/agent/watch-errors.sh
UNIT

cat > /etc/systemd/system/evg-watch-errors.timer <<'UNIT'
[Unit]
Description=EVG — surveillance toutes les 2 minutes

[Timer]
OnBootSec=4min
OnUnitActiveSec=2min
AccuracySec=15s

[Install]
WantedBy=timers.target
UNIT

systemctl daemon-reload
systemctl enable --now hermes-gateway || echo "WARN: hermes-gateway n'a pas démarré"
%{ if site_repo_url != "" ~}
systemctl enable --now evg-watch-errors.timer
%{ endif ~}

echo "=== Terminé ==="
echo "Agents  : tailscale ssh hermes@${instance_name}"
echo "App     : $APP_HOST (surveillée depuis ici)"
