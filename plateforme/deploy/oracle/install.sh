#!/usr/bin/env bash
# INSTALLER LA DÉMONSTRATION SUR UNE VM ORACLE CLOUD « ALWAYS FREE » (Ubuntu 22.04/24.04).
#
#   git clone <dépôt> elourwa && cd elourwa/deploy/oracle && sudo bash install.sh
#
# Ce que fait ce script, dans l'ordre, et pourquoi :
#   1. Ouvre 80 et 443 dans le pare-feu DE LA VM — les images Ubuntu d'Oracle
#      arrivent avec des règles iptables qui refusent tout sauf le SSH ; ouvrir
#      le port dans la console (« Security List ») ne suffit pas, il faut les deux.
#   2. Installe Docker (dépôt officiel) s'il manque.
#   3. Écrit `.env` : mots de passe tirés au sort, paire de clés ES256 pour les
#      jetons (règle 12), le nom public `<ip-avec-tirets>.sslip.io`.
#   4. Construit l'image, lance Postgres → migrations → mots de passe des rôles
#      (0001 les crée avec « devpassword ») → graine de démonstration (3 écoles,
#      600 élèves) → API, site, Caddy (HTTPS automatique).
#
# Relancer le script est sans danger : `.env` est conservé, la graine n'est
# posée que si la base est vide.
set -euo pipefail
ICI="$(cd "$(dirname "$0")" && pwd)"
cd "$ICI"

[ "$(id -u)" -eq 0 ] || { echo "Lancez avec sudo." >&2; exit 2; }

# 1. Le pare-feu de la VM (voir en tête).
if command -v iptables >/dev/null; then
  for p in 80 443; do
    iptables -C INPUT -p tcp --dport "$p" -j ACCEPT 2>/dev/null || iptables -I INPUT 6 -p tcp --dport "$p" -j ACCEPT
  done
  if command -v netfilter-persistent >/dev/null; then netfilter-persistent save >/dev/null 2>&1 || true
  elif [ -f /etc/iptables/rules.v4 ]; then iptables-save > /etc/iptables/rules.v4; fi
fi

# 2. Docker.
if ! command -v docker >/dev/null; then
  apt-get update -qq
  apt-get install -y -qq ca-certificates curl gnupg >/dev/null
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
  . /etc/os-release
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" > /etc/apt/sources.list.d/docker.list
  apt-get update -qq
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-compose-plugin >/dev/null
fi

# 3. `.env` — une fois.
if [ ! -f .env ]; then
  IP="${PUBLIC_IP:-$(curl -fsS -4 https://api.ipify.org || curl -fsS -4 https://ifconfig.me)}"
  DOMAIN="${PUBLIC_DOMAIN:-$(echo "$IP" | tr . -).sslip.io}"
  # ES256 : une clé P-256, la privée en PKCS#8, la publique en SPKI — sur UNE ligne
  # chacune (les retours à la ligne deviennent \n ; l'API les rétablit).
  PRIV=$(openssl ecparam -name prime256v1 -genkey -noout | openssl pkcs8 -topk8 -nocrypt)
  PUB=$(printf '%s\n' "$PRIV" | openssl ec -pubout 2>/dev/null)
  une_ligne() { awk 'BEGIN{ORS="\n"} {print}'; }
  cat > .env <<ENV
PUBLIC_DOMAIN=$DOMAIN
ACME_EMAIL=${ACME_EMAIL:-admin@$DOMAIN}
POSTGRES_PASSWORD=$(openssl rand -hex 24)
APP_USER_PASSWORD=$(openssl rand -hex 24)
APP_REPORTER_PASSWORD=$(openssl rand -hex 24)
JWT_PRIVATE_KEY="$(printf '%s\n' "$PRIV" | une_ligne)"
JWT_PUBLIC_KEY="$(printf '%s\n' "$PUB" | une_ligne)"
# Le courrier (réinitialisations de mot de passe) : facultatif pour une démo.
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASSWORD=
SMTP_FROM=
# Notifications push (Firebase) : facultatif ; sans lui l'application interroge le serveur.
FCM_SERVICE_ACCOUNT=
ENV
  chmod 600 .env
  echo "→ .env écrit : domaine public $DOMAIN"
fi
set -a; . ./.env; set +a

# 4. Construire et lancer.
docker compose build --quiet
docker compose up -d db
docker compose run --rm api pnpm db:migrate
docker compose exec -T db psql -U postgres -d elourwa -v ON_ERROR_STOP=1 \
  -c "ALTER ROLE app_user PASSWORD '${APP_USER_PASSWORD}';" \
  -c "ALTER ROLE app_reporter PASSWORD '${APP_REPORTER_PASSWORD}';" >/dev/null
ECOLES=$(docker compose exec -T db psql -U postgres -d elourwa -tAc "SELECT count(*) FROM schools")
if [ "${ECOLES:-0}" = "0" ]; then
  echo "→ base vide : graine de démonstration (3 écoles, 600 élèves)…"
  docker compose run --rm api pnpm seed
fi
docker compose up -d

cat <<FIN

✓ En ligne (les certificats arrivent dans la minute) :
    Site des écoles     https://nour.${PUBLIC_DOMAIN}/   (admin@nour.test / dev12345)
                        https://rissala.${PUBLIC_DOMAIN}/  https://salam.${PUBLIC_DOMAIN}/
    Console             https://admin.${PUBLIC_DOMAIN}/  (admin@platform.test / dev12345)
    API (application)   https://api.${PUBLIC_DOMAIN}/health

  Application Android : construire avec
    API_URL=https://api.${PUBLIC_DOMAIN} tools/packager.sh apk
  puis se connecter avec 30000000 / dev12345 (un parent dans les trois écoles).

  Journal : docker compose logs -f api web caddy
FIN
