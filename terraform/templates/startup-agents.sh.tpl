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
# python3 make g++ : better-sqlite3 embarque un binding.gyp et AUCUN script
# d'install, donc npm lance `node-gyp rebuild` par défaut, même avec des
# prebuilds disponibles. Sans les trois, `npm ci` échoue en entier sur
# « not found: make » — et le gate que le code agent doit exécuter ici
# (typecheck, tests, next build) ne peut pas tourner du tout.
# Le Dockerfile de l'app installe les mêmes trois, pour la même raison.
apt-get install -y curl git ufw ca-certificates jq python3 make g++

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
# OpenCode seul. C'est le runtime que les agents utilisent (AGENT_RUNTIME
# plus bas). lib.sh sait aussi piloter Claude Code, pour un humain en local,
# mais la VM n'en a pas besoin : un outil installé de plus est une surface de
# plus a maintenir et a mettre a jour.
# Antigravity CLI (agy) : le runtime des agents. Go, pas de Node.
su - hermes -c "curl -fsSL https://antigravity.google/cli/install.sh | bash" \
  || echo "WARN: installation d Antigravity echouee — les agents ne pourront pas tourner"

# OpenCode reste installe : lib.sh sait piloter les deux, et avoir un second
# runtime sous la main a deja servi a isoler un bug de client.
su - hermes -c "curl -fsSL https://opencode.ai/install | bash" \
  || echo "WARN: installation d OpenCode echouee (secondaire)"

# La clé Agent Platform, exposée sous LES DEUX noms attendus par les SDK
# Google : le nom exact dépend de la version du SDK, et se tromper ne produit
# qu'un « pas de clé » silencieux.
mkdir -p /home/hermes/.hermes
cat > /home/hermes/.hermes/.env <<ENVFILE
# Le seul nom de la chaîne : secret GitHub, variable Terraform, ligne de .env
# et variable lue par agy portent tous celui-ci.
GEMINI_API_KEY=${gemini_api_key}
LLM_MODEL=${llm_model}
LLM_PROVIDER=${llm_provider}
AGENT_RUNTIME=antigravity
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
# Antigravity : authentification par clé d'API, la seule voie non interactive
# qui marche ici. Le compte de service de la VM ne lui sert à rien, et la voie
# OAuth demanderait un navigateur qu'une VM n'a pas.
mkdir -p /home/hermes/.gemini/antigravity-cli
cat > /home/hermes/.gemini/antigravity-cli/settings.json <<'AGYJSON'
{
  "modelProvider": "gemini"
}
AGYJSON
chown -R hermes:hermes /home/hermes/.gemini
chmod 700 /home/hermes/.gemini/antigravity-cli

mkdir -p /home/hermes/.config/opencode
%{ if llm_provider == "google-vertex" ~}
# Vertex AI par le compte de service attaché à la VM : pas de clé sur la
# machine, rien à faire tourner, rien à révoquer si elle est compromise — il
# suffit de détacher le compte.
#
# `location: global` parce que c'est la seule qui sert le modèle : les
# endpoints régionaux répondent 404 pour gemini-3.8-flash sur ce projet.
cat > /home/hermes/.config/opencode/opencode.json <<OCJSON
{
  "\$schema": "https://opencode.ai/config.json",
  "model": "${llm_model}",
  "provider": {
    "google-vertex": {
      "options": {
        "project": "${project_id}",
        "location": "global"
      }
    }
  }
}
OCJSON
%{ else ~}
cat > /home/hermes/.config/opencode/opencode.json <<OCJSON
{
  "\$schema": "https://opencode.ai/config.json",
  "model": "${llm_model}",
  "provider": {
    "${llm_provider}": {
      "options": {
        "apiKey": "{env:GEMINI_API_KEY}"
%{ if llm_base_url != "" ~}
        , "baseURL": "${llm_base_url}"
%{ endif ~}
      }
    }
  }
}
OCJSON
%{ endif ~}
chown -R hermes:hermes /home/hermes/.config

cat >> /home/hermes/.bashrc <<'BASHRC'
set -a
# opencode s'installe dans ~/.opencode/bin, absent du PATH par défaut. Pour
# un humain qui se connecte ; les scripts, eux, le résolvent dans lib.sh,
# parce qu'un service systemd ne lit jamais ce fichier.
export PATH="$HOME/.opencode/bin:$HOME/.local/bin:$PATH"
[ -f /home/hermes/.hermes/.env ] && . /home/hermes/.hermes/.env
set +a
export AGENT_RUNTIME=antigravity
BASHRC
chown hermes:hermes /home/hermes/.bashrc

%{ if site_repo_url != "" ~}
echo "=== [7/8] Dépôt de travail ==="
# Idempotent on purpose: a GCE startup script runs at EVERY boot, and with
# `set -e` an unguarded `git clone` into an existing directory aborts the whole
# script — leaving the machine half-configured after any reboot, maintenance
# event or live migration. That also makes a reboot the safe way to re-run this
# script, which is how a changed Tailscale tag gets applied.
if [ -d "$SITE_DIR/.git" ]; then
  su - hermes -c "cd $SITE_DIR && git fetch --quiet origin && git reset --hard --quiet origin/HEAD" \
    || su - hermes -c "cd $SITE_DIR && git fetch --quiet origin main && git reset --hard --quiet origin/main"
else
  su - hermes -c "git clone ${site_repo_url} $SITE_DIR"
fi
# Écrits par hermes, jamais par root : un `sudo ./status.sh` suffisait à
# laisser .agent-logs appartenir à root, et `tee` échouait alors en emportant
# LA SORTIE DE L'AGENT — le pipeline concluait « open questions » sans avoir
# reçu le moindre rapport.
mkdir -p $SITE_DIR/.agent-logs $SITE_DIR/data/hermes
chown -R hermes:hermes $SITE_DIR/.agent-logs $SITE_DIR/data
chmod 700 $SITE_DIR/data/hermes

su - hermes -c "cd $SITE_DIR && git config user.name '${git_author_name}'"
su - hermes -c "cd $SITE_DIR && git config user.email '${git_author_email}'"
# Pousser une branche courante par défaut, jamais main : l'agent crée
# explicitement sa branche, ceci n'est qu'une ceinture de plus.
su - hermes -c "cd $SITE_DIR && git config push.default current"
if ! su - hermes -c "cd $SITE_DIR && npm ci"; then
  # Avalé par un || echo jusqu'ici, ce qui laissait node_modules VIDE et la
  # passerelle comme le gate incapables de démarrer, sans rien de visible.
  echo "WARN: npm ci a ÉCHOUÉ. node_modules est vide :"
  echo "WARN:   - la passerelle Telegram ne démarrera pas (pas de tsx)"
  echo "WARN:   - le code agent ne peut pas exécuter le gate"
  echo "WARN: relancer sur la VM : cd $SITE_DIR && npm ci"
fi
%{ else ~}
echo "=== [7/8] Pas de site_repo_url : dépôt non cloné ==="
%{ endif ~}

# Le modèle répond-il vraiment ? Un provider mal configuré ne se voit pas :
# les services démarrent, le bot écoute, et chaque demande échoue plus tard sur
# une erreur d'API que personne ne relie au boot. Un appel trivial ici, et le
# journal de démarrage porte la réponse.
echo "=== [7b/8] Le runtime des agents est-il utilisable ? ==="
# agy ne s'authentifie PAS avec le compte de service de la VM : sa seule voie
# non interactive documentée est une cle GEMINI_API_KEY vers
# generativelanguage, que la policy Google par defaut de ce projet bloque. Il
# faut donc une connexion OAuth, une fois, faite par un humain.
if su - hermes -c "export PATH=\$HOME/.local/bin:\$PATH && timeout 60 agy -p 'Réponds exactement: PRET' --model gemini-3.8-flash --effort low 2>&1 | tail -3" | grep -qi "pret"; then
  echo "OK: agy est authentifie et le modele repond"
else
  echo "WARN: agy N EST PAS authentifie. Aucun agent ne pourra tourner."
  echo "WARN: une seule fois, depuis un poste avec navigateur :"
  echo "WARN:   tailscale ssh hermes@${instance_name}"
  echo "WARN:   agy            # colle l URL dans ton navigateur, reporte le code"
  echo "WARN: puis: systemctl restart hermes-gateway"
fi

echo "=== [8/8] Services systemd ==="
cat > /etc/systemd/system/hermes-gateway.service <<'UNIT'
[Unit]
Description=Hermes Telegram gateway (spec 0012)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=hermes
WorkingDirectory=/home/hermes/site
EnvironmentFile=/home/hermes/.hermes/.env
ExecStart=/usr/bin/env npm run --silent hermes:gateway
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

# Le workflow *Deploy infra* redémarre la passerelle à distance, en SSH comme
# hermes. Plutôt que de donner root à la CI, un droit sudo limité À CETTE SEULE
# unité : la CI ne peut rien faire d'autre avec.
cat > /etc/sudoers.d/hermes-gateway <<'SUDOERS'
hermes ALL=(root) NOPASSWD: /usr/bin/systemctl restart hermes-gateway, /usr/bin/systemctl restart hermes-gateway.service
SUDOERS
chmod 440 /etc/sudoers.d/hermes-gateway
# Un sudoers invalide verrouille sudo pour tout le monde : on valide avant de
# le laisser en place.
visudo -cf /etc/sudoers.d/hermes-gateway >/dev/null \
  || { echo "WARN: sudoers invalide, retiré"; rm -f /etc/sudoers.d/hermes-gateway; }

systemctl daemon-reload
# La passerelle vit dans le dépôt (src/hermes, spec 0012) et tourne via npm,
# donc elle a besoin des node_modules : sans eux le service boucle sur un
# redémarrage, ce qui est moins lisible qu'un message ici.
if [ -d "$SITE_DIR/node_modules/.bin" ]; then
  systemctl enable --now hermes-gateway \
    || echo "WARN: hermes-gateway n'a pas démarré — journalctl -u hermes-gateway"
else
  systemctl enable hermes-gateway
  echo "WARN: node_modules absent : npm ci a échoué plus haut."
  echo "WARN: la passerelle ne démarrera pas. Relancer sur la VM :"
  echo "WARN:   cd $SITE_DIR && npm ci && sudo systemctl start hermes-gateway"
fi

# Sans jeton il n'y a pas de bot, et le service sortira en échec à chaque
# démarrage. Le dire une fois vaut mieux qu'un journal qui boucle.
if ! grep -q '^TELEGRAM_BOT_TOKEN=.' /home/hermes/.hermes/.env; then
  echo "WARN: TELEGRAM_BOT_TOKEN est vide : la passerelle refusera de démarrer."
fi
if ! grep -q '^TELEGRAM_ALLOWED_USERS=.' /home/hermes/.hermes/.env; then
  echo "WARN: TELEGRAM_ALLOWED_USERS est vide : la passerelle refusera TOUT LE MONDE."
fi
%{ if site_repo_url != "" ~}
systemctl enable --now evg-watch-errors.timer
%{ endif ~}

echo "=== Terminé ==="
echo "Agents  : tailscale ssh hermes@${instance_name}"
echo "App     : $APP_HOST (surveillée depuis ici)"
