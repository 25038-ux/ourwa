#!/usr/bin/env bash
# INSTALLER — OU METTRE À JOUR — JINAN SUR UN SERVEUR (Ubuntu 22.04 / 24.04).
# Prévu pour un VPS Hostinger KVM 1 (1 vCPU AMD EPYC, 4 Go, 50 Go NVMe) ; tout
# VPS d'au moins 1 vCPU et 2 Go convient.
#
#   cd /opt/jinan/deploy/jinan
#   sudo PUBLIC_DOMAIN=jinan-ecole.com ACME_EMAIL=infoheavenly24@gmail.com \
#        ADMIN_EMAIL=infoheavenly24@gmail.com ADMIN_PASSWORD='<mot-de-passe-provisoire>' bash install.sh
#
# ACME_EMAIL : l'adresse (réelle) de contact des certificats HTTPS — obligatoire.
#
# ADMIN_PASSWORD est facultatif (sinon un mot de passe provisoire est tiré au
# sort) ; dans les deux cas il est À CHANGER à la première connexion. Entre
# apostrophes droites : le « ! » ne doit pas être interprété par bash.
#
# Ce que fait ce script, dans l'ordre :
#   1. La machine : 2 Go d'échange (swap) s'il n'y en a pas, mises à jour de
#      sécurité automatiques, Docker (dépôt officiel) s'il manque, les ports
#      22/80/443 dans le pare-feu de la machine SEULEMENT s'il filtre déjà.
#   2. `.env`, écrit UNE fois et d'un coup : mots de passe tirés au sort, paire
#      de clés ES256 des jetons, le domaine, l'enseigne, les mentions des pages
#      légales. Une version plus récente y AJOUTE ses clés sans toucher aux
#      autres. La clé Firebase (secrets/) devient un fichier monté dans l'API.
#   3. Le DNS : les trois noms doivent viser ce serveur, sans enregistrement
#      AAAA. Un écart est signalé, jamais bloquant (Caddy réessaie seul).
#   4. Construit l'image, lance Postgres → migrations → mots de passe des rôles
#      → l'école sur une base NEUVE (rôles, la ligne de l'école, un compte de
#      direction à mot de passe provisoire — aucune donnée de démonstration)
#      → API, site, Caddy (HTTPS automatique) ; attend que l'API réponde.
#   5. La sauvegarde nocturne (sauvegarde.sh, 02:30, 14 jours gardés).
#
# RELANCER CE SCRIPT EST SANS DANGER — et c'est ainsi qu'on met à jour : `.env`
# et secrets/ sont conservés, l'école n'est installée que si elle n'existe pas
# encore, le compte de direction n'est pas touché.
#
# ⚠ CE QUE CETTE VERSION CORRIGE (0.7.2) — l'ancien script :
#   - s'arrêtait au pare-feu sur une machine neuve : `iptables -I INPUT 6`,
#     hérité des images Oracle (cinq règles d'origine), échoue sur une chaîne
#     vide (« Index of insertion too big ») et `set -e` coupait tout ;
#   - s'arrêtait juste après avoir écrit `.env`, puis à CHAQUE relance :
#     `SCHOOL_NAME=Jinan`, sans guillemets, relu par bash (`. ./.env`)
#     devient la commande « Mourad » (« command not found », code 127).
#     `.env` n'est plus jamais exécuté par bash : il est LU (voir `lire`) ;
#   - ne donnait la clé Firebase qu'à son propre shell : la première mise à jour
#     (`docker compose up -d`) recréait l'API sans elle, et les notifications
#     s'arrêtaient sans un mot. Elle est désormais un fichier monté ;
#   - laissait le mot de passe provisoire lisible par tous dans /tmp ;
#   - n'avait ni swap, ni plafond des journaux Docker (qui remplissent le disque
#     en quelques mois), ni sauvegarde utilisable (scripts/backup.sh veut
#     pg_dump sur la machine et une base joignable : ici tout est dans Docker).
set -euo pipefail
ICI="$(cd "$(dirname "$0")" && pwd)"
RACINE="$(cd "$ICI/../.." && pwd)"
MARQUE_FICHIER="$RACINE/deploy/brands/jinan.env"
cd "$ICI"

vert()  { printf '\033[32m✓ %s\033[0m\n' "$*"; }
jaune() { printf '\033[33m! %s\033[0m\n' "$*"; }
rouge() { printf '\033[31m✗ %s\033[0m\n' "$*" >&2; }
titre() { printf '\n\033[1m── %s ──\033[0m\n' "$*"; }

[ "$(id -u)" -eq 0 ] || { rouge "Lancez avec sudo."; exit 2; }
[ -f "$MARQUE_FICHIER" ] || { rouge "Fichier de marque introuvable : $MARQUE_FICHIER"; exit 2; }

# ── Lire et écrire `.env` sans jamais l'exécuter ─────────────────────────────
# docker compose lit `.env` lui-même ; ce script n'en a besoin que de quelques
# valeurs. `lire` accepte les trois formes : nue, 'citée', "citée" — donc aussi
# un `.env` laissé par l'ancien script.
lire() {
  [ -f .env ] || return 0
  sed -n "s/^$1=//p" .env | tail -n1 | sed -e "s/^'\(.*\)'\$/\1/" -e 's/^"\(.*\)"$/\1/'
}
# Pose (ou remplace) une clé ; la valeur est écrite telle quelle, déjà citée.
poser() {
  local tmp
  tmp="$(mktemp "$ICI/.env.XXXXXX")"
  grep -v "^$1=" .env > "$tmp" || true
  printf '%s=%s\n' "$1" "$2" >> "$tmp"
  chmod 600 "$tmp"
  mv "$tmp" .env
}
ajouter_si_absente() { grep -q "^$1=" .env || printf '%s=%s\n' "$1" "$2" >> .env; }
# Une valeur du fichier de marque (les faits de l'école : LEGAL_*).
lire_marque() {
  sed -n "s/^$1=//p" "$MARQUE_FICHIER" | tail -n1 | sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'\$/\1/"
}
# Une valeur libre, citée pour docker compose : entre ' ', donc littérale (ni
# `$`, ni `#`, ni espaces n'y posent problème). L'apostrophe droite fermerait la
# citation : elle devient l'apostrophe typographique ’.
citer() { printf "'%s'" "${1//\'/’}"; }
# Une valeur définie pour CE lancement (`LEGAL_PHONE=… bash install.sh`) remplace
# celle de `.env` ; sinon la clé n'est ajoutée que si elle manque.
retenir() {  # retenir CLÉ valeur-par-défaut
  local cle="$1" defaut="$2"
  if [ -n "${!cle:-}" ]; then poser "$cle" "$(citer "${!cle}")"
  else ajouter_si_absente "$cle" "$(citer "$defaut")"; fi
}

# ═════════════════════════════════════════════════════════════════════════════
titre "1. La machine"
export DEBIAN_FRONTEND=noninteractive
# Une machine neuve lance souvent ses propres mises à jour au démarrage : on
# attend le verrou d'apt au lieu d'échouer dessus.
APT=(apt-get -qq -o DPkg::Lock::Timeout=600)

# L'échange : `next build` sur un seul vCPU peut dépasser la mémoire vive.
if [ -z "$(swapon --show=NAME --noheadings 2>/dev/null)" ]; then
  if [ ! -f /swapfile ]; then
    fallocate -l 2G /swapfile 2>/dev/null || dd if=/dev/zero of=/swapfile bs=1M count=2048 status=none
    chmod 600 /swapfile
    mkswap /swapfile >/dev/null
  fi
  if swapon /swapfile 2>/dev/null; then
    grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
    vert "2 Go d'échange (swap) activés"
  else
    jaune "swap non activé (sans gravité : la construction sera seulement plus lente)"
  fi
else
  vert "échange (swap) déjà présent"
fi

# Une mise à jour n'a pas besoin d'apt (Docker est déjà là) : un dépôt de
# paquets injoignable ne doit pas arrêter la mise à jour du site.
"${APT[@]}" update || jaune "apt-get update a échoué (sans gravité si Docker est déjà installé)"
"${APT[@]}" install -y ca-certificates curl gnupg openssl unattended-upgrades >/dev/null \
  || jaune "paquets système non mis à jour (sans gravité si Docker est déjà installé)"
if [ ! -f /etc/apt/apt.conf.d/20auto-upgrades ]; then
  printf 'APT::Periodic::Update-Package-Lists "1";\nAPT::Periodic::Unattended-Upgrade "1";\n' \
    > /etc/apt/apt.conf.d/20auto-upgrades
fi
vert "mises à jour de sécurité automatiques"

if ! command -v docker >/dev/null || ! docker compose version >/dev/null 2>&1; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor --yes -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
  . /etc/os-release
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" \
    > /etc/apt/sources.list.d/docker.list
  "${APT[@]}" update
  "${APT[@]}" install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin >/dev/null
fi
systemctl enable --now docker >/dev/null 2>&1 || true
vert "$(docker --version | cut -d, -f1), $(docker compose version --short 2>/dev/null | sed 's/^/compose /')"

# Le pare-feu de LA MACHINE — seulement s'il filtre déjà quelque chose. (Celui
# de Hostinger, dans hPanel, est un autre : s'il est activé, il doit laisser
# passer 22, 80 et 443.) Une règle s'insère en tête (position 1), ce qui
# réussit quelle que soit la longueur de la chaîne.
if command -v ufw >/dev/null && ufw status 2>/dev/null | grep -q 'Status: active'; then
  for p in 22 80 443; do ufw allow "$p/tcp" >/dev/null; done
  vert "pare-feu ufw : 22, 80 et 443 ouverts"
elif command -v iptables >/dev/null && iptables -S INPUT 2>/dev/null | grep -qE '^-P INPUT DROP|-j (DROP|REJECT)'; then
  for p in 80 443; do
    iptables -C INPUT -p tcp --dport "$p" -j ACCEPT 2>/dev/null \
      || iptables -I INPUT 1 -p tcp --dport "$p" -j ACCEPT
  done
  if command -v netfilter-persistent >/dev/null; then netfilter-persistent save >/dev/null 2>&1 || true
  elif [ -d /etc/iptables ]; then iptables-save > /etc/iptables/rules.v4; fi
  vert "iptables : 80 et 443 ouverts"
else
  vert "aucun pare-feu actif sur la machine"
fi

# ═════════════════════════════════════════════════════════════════════════════
titre "2. La configuration (.env)"
# Sans PUBLIC_DOMAIN : celui de production.env (configurer-production.sh), s'il
# est rempli — une première installation n'a alors plus qu'à dire l'e-mail.
if [ -z "${PUBLIC_DOMAIN:-}" ] && [ -f "$ICI/production.env" ]; then
  PUBLIC_DOMAIN="$(sed -n 's/^JINAN_DOMAINE=//p' "$ICI/production.env" | tr -d '[:space:]')"
fi
DOMAINE_DEMANDE="$(printf '%s' "${PUBLIC_DOMAIN:-}" | tr 'A-Z' 'a-z')"
if [ ! -f .env ]; then
  : "${PUBLIC_DOMAIN:?Indiquez le domaine : sudo PUBLIC_DOMAIN=jinan-ecole.com ADMIN_EMAIL=... bash install.sh}"
  : "${ADMIN_EMAIL:?Indiquez l’adresse de la direction : ADMIN_EMAIL=prenom.nom@exemple.com}"
  : "${ACME_EMAIL:?Indiquez l’adresse de contact des certificats : ACME_EMAIL=infoheavenly24@gmail.com}"
  PUBLIC_DOMAIN="$(printf '%s' "$PUBLIC_DOMAIN" | tr 'A-Z' 'a-z')"
  case "$PUBLIC_DOMAIN" in
    *://*|*/*|*' '*|www.*|api.*|'') rouge "PUBLIC_DOMAIN : le nom seul, sans https://, sans www. ni api. (ex. jinan-ecole.com)"; exit 2 ;;
  esac
  if ! printf '%s' "$ADMIN_EMAIL" | grep -qE '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'; then
    rouge "ADMIN_EMAIL « $ADMIN_EMAIL » n’est pas une adresse électronique"; exit 2
  fi
  case "${SMTP_PASSWORD:-}" in
    *\'*) rouge "SMTP_PASSWORD contient une apostrophe : lancez sans SMTP_*, puis écrivez-le dans .env à la main."; exit 2 ;;
  esac
  # ES256 : une clé P-256, la privée en PKCS#8, la publique en SPKI — sur UNE
  # ligne chacune (les retours à la ligne deviennent \n ; l'API les rétablit).
  PRIV=$(openssl ecparam -name prime256v1 -genkey -noout | openssl pkcs8 -topk8 -nocrypt)
  PUB=$(printf '%s\n' "$PRIV" | openssl ec -pubout 2>/dev/null)
  une_ligne() { awk 'BEGIN{ORS="\\n"} {print}'; }
  TMP="$(mktemp "$ICI/.env.XXXXXX")"
  chmod 600 "$TMP"
  {
    echo "# Jinan — écrit par install.sh le $(date -u +%Y-%m-%dT%H:%MZ)."
    echo "# Lu par docker compose, jamais exécuté par bash. Après une modification : docker compose up -d"
    echo "PUBLIC_DOMAIN=$PUBLIC_DOMAIN"
    echo "ACME_EMAIL=$ACME_EMAIL"
    NOM="${SCHOOL_NAME:-$(lire_marque SCHOOL_NAME)}"
    NOM_AR="${SCHOOL_NAME_AR:-$(lire_marque SCHOOL_NAME_AR)}"
    echo "SCHOOL_NAME=$(citer "${NOM:-Jinan}")"
    echo "SCHOOL_NAME_AR=$(citer "${NOM_AR:-جنان}")"
    echo "SCHOOL_RECEIPT_PREFIX=${SCHOOL_RECEIPT_PREFIX:-JIN}"
    echo "ADMIN_EMAIL=$ADMIN_EMAIL"
    echo "ADMIN_NAME=$(citer "${ADMIN_NAME:-Direction}")"
    # L'enseigne, recopiée du fichier de marque — sauf l'expéditeur du
    # courrier, qui suit le domaine réel (un autre domaine échouerait SPF/DMARC).
    { grep -E '^(BRAND_|SINGLE_SCHOOL_SLUG=|PLATFORM_CONSOLE=)' "$MARQUE_FICHIER" | grep -v '^BRAND_MAIL_FROM='; } || true
    echo "BRAND_MAIL_FROM=no-reply@$PUBLIC_DOMAIN"
    echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)"
    echo "APP_USER_PASSWORD=$(openssl rand -hex 24)"
    echo "APP_REPORTER_PASSWORD=$(openssl rand -hex 24)"
    echo "JWT_PRIVATE_KEY=\"$(printf '%s\n' "$PRIV" | une_ligne)\""
    echo "JWT_PUBLIC_KEY=\"$(printf '%s\n' "$PUB" | une_ligne)\""
    echo "SMTP_HOST=${SMTP_HOST:-}"
    echo "SMTP_PORT=${SMTP_PORT:-587}"
    echo "SMTP_SECURE=${SMTP_SECURE:-false}"
    echo "SMTP_USER=${SMTP_USER:-}"
    echo "SMTP_PASSWORD='${SMTP_PASSWORD:-}'"
    echo "SMTP_FROM=${SMTP_FROM:-no-reply@$PUBLIC_DOMAIN}"
    echo "FCM_SERVICE_ACCOUNT="
  } > "$TMP"
  mv "$TMP" .env   # d'un coup : une interruption ne laisse jamais un .env à moitié écrit
  vert ".env écrit (domaine $PUBLIC_DOMAIN)"
else
  chmod 600 .env
  vert ".env existant conservé"
fi

PUBLIC_DOMAIN="$(lire PUBLIC_DOMAIN)"
if [ -n "$DOMAINE_DEMANDE" ] && [ "$DOMAINE_DEMANDE" != "$PUBLIC_DOMAIN" ]; then
  jaune "PUBLIC_DOMAIN=$DOMAINE_DEMANDE demandé, mais .env dit $PUBLIC_DOMAIN : .env fait foi (pour changer de domaine, modifiez .env puis relancez)."
fi

# L'adresse ACME : donnée à ce lancement, elle remplace celle de .env ; sans
# aucune des deux, Caddy ne démarrerait pas (« email » vide) — on s'arrête ici.
if [ -n "${ACME_EMAIL:-}" ]; then poser ACME_EMAIL "$ACME_EMAIL"; fi
if [ -z "$(lire ACME_EMAIL)" ]; then
  rouge "ACME_EMAIL manque : relancez avec ACME_EMAIL=votre.adresse@exemple.com"; exit 2
fi
if ! lire ACME_EMAIL | grep -qE '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'; then
  rouge "ACME_EMAIL « $(lire ACME_EMAIL) » n’est pas une adresse électronique"; exit 2
fi

# Les clés qu'une version précédente n'écrivait pas — ajoutées, jamais écrasées.
MAIL_FROM_ACTUEL="$(lire BRAND_MAIL_FROM)"
case "$MAIL_FROM_ACTUEL" in
  *@"$PUBLIC_DOMAIN") ;;
  *) poser BRAND_MAIL_FROM "no-reply@$PUBLIC_DOMAIN" ;;
esac
[ -n "$(lire SMTP_FROM)" ] || poser SMTP_FROM "no-reply@$PUBLIC_DOMAIN"
ajouter_si_absente SMTP_SECURE false
# Les mentions des pages publiques /legal/… (confidentialité, conditions,
# suppression de compte) — lues par le site à chaque affichage. Pour les
# changer : `sudo LEGAL_PHONE="+222 …" bash install.sh`, ou modifier .env puis
# `docker compose up -d web`.
# Par défaut, les faits du fichier de marque ; l'adresse électronique n'est
# JAMAIS celle du compte de direction (elle peut être fictive) : sans LEGAL_EMAIL,
# la ligne « courriel » des pages légales ne s'affiche pas.
defaut() { local v; v="$(lire_marque "$1")"; printf '%s' "${v:-$2}"; }
retenir LEGAL_ENTITY     "$(defaut LEGAL_ENTITY "$(lire SCHOOL_NAME)")"
retenir LEGAL_ENTITY_AR  "$(defaut LEGAL_ENTITY_AR "$(lire SCHOOL_NAME_AR)")"
retenir LEGAL_ADDRESS    "$(defaut LEGAL_ADDRESS "Nouakchott, Mauritanie")"
retenir LEGAL_ADDRESS_AR "$(defaut LEGAL_ADDRESS_AR "نواكشوط، موريتانيا")"
retenir LEGAL_EMAIL      "$(defaut LEGAL_EMAIL "")"
retenir LEGAL_PHONE      "$(defaut LEGAL_PHONE "")"
# L'hébergeur, que la politique de confidentialité nomme : celui du fichier de
# marque (configurer-production.sh l'y écrit) — l'ancien texte figé nommait
# Hostinger même sur un autre VPS.
retenir LEGAL_HOST       "$(defaut LEGAL_HOST "Hostinger International Ltd — serveur situé dans l’Union européenne")"
retenir LEGAL_HOST_AR    "$(defaut LEGAL_HOST_AR "Hostinger International Ltd — خادم في الاتحاد الأوروبي")"
retenir LEGAL_UPDATED    "$(date +%Y-%m-%d)"
# Le nom du frais annuel « photocopie » (« Frais Graytna ») : celui du fichier de
# marque, remis à chaque mise à jour — c'est un fait de l'école, pas un réglage
# du serveur. Sans valeur dans le fichier de marque : « Frais de photocopie ».
FRAIS_PHOTOCOPIE_MARQUE="$(lire_marque FEE_PHOTOCOPY_LABEL)"
if [ -n "$FRAIS_PHOTOCOPIE_MARQUE" ]; then poser FEE_PHOTOCOPY_LABEL "$(citer "$FRAIS_PHOTOCOPIE_MARQUE")"; fi
# Le nom de l'école, tel que le site l'affiche (barre latérale, connexion,
# reçus, bulletins) : celui du fichier de marque — ou SCHOOL_NAME=… donné à ce
# lancement —, remis à chaque mise à jour, puis appliqué à l'école en base
# (`bootstrap-school --sync-name`, plus bas). Un fait de l'école, comme le nom
# du frais de photocopie.
NOM_ECOLE="${SCHOOL_NAME:-$(lire_marque SCHOOL_NAME)}"
NOM_ECOLE_AR="${SCHOOL_NAME_AR:-$(lire_marque SCHOOL_NAME_AR)}"
if [ -n "$NOM_ECOLE" ]; then poser SCHOOL_NAME "$(citer "$NOM_ECOLE")"; fi
if [ -n "$NOM_ECOLE_AR" ]; then poser SCHOOL_NAME_AR "$(citer "$NOM_ECOLE_AR")"; fi
# Les échecs de connexion tolérés par adresse IP en 15 minutes. Les opérateurs
# mobiles mauritaniens mettent des milliers de téléphones derrière une même
# adresse : 15 (la valeur du code) bloquerait tout un réseau le jour où les
# familles tapent leur mot de passe provisoire. Chaque compte reste verrouillé
# après 5 échecs, quoi qu'il arrive.
ajouter_si_absente LOGIN_IP_MAX_ATTEMPTS 60

for v in ADMIN_EMAIL ADMIN_NAME SCHOOL_NAME SCHOOL_NAME_AR SCHOOL_RECEIPT_PREFIX \
         SINGLE_SCHOOL_SLUG APP_USER_PASSWORD APP_REPORTER_PASSWORD; do
  printf -v "$v" '%s' "$(lire "$v")"
done
if [ -z "$PUBLIC_DOMAIN" ] || [ -z "$SINGLE_SCHOOL_SLUG" ] || [ -z "$APP_USER_PASSWORD" ] || [ -z "$ADMIN_EMAIL" ]; then
  rouge ".env incomplet (PUBLIC_DOMAIN, SINGLE_SCHOOL_SLUG, APP_USER_PASSWORD, ADMIN_EMAIL). Comparez avec .env.example."
  exit 2
fi

# La clé Firebase : un FICHIER, monté dans l'API (docker-compose.yml) — elle
# survit donc à toutes les mises à jour. L'API accepte un chemin comme un JSON.
mkdir -p secrets && chmod 700 secrets
CLE_FCM=secrets/fcm-service-account.json
FCM_DANS_API=/run/secrets/jinan/fcm-service-account.json
if [ -f "$CLE_FCM" ]; then
  chmod 600 "$CLE_FCM"
  if ! grep -q '"private_key"' "$CLE_FCM" || ! grep -q '"client_email"' "$CLE_FCM"; then
    rouge "$CLE_FCM n'est pas une clé de compte de service (private_key / client_email absents)."
    rouge "Firebase → ⚙ Paramètres du projet → Comptes de service → Générer une nouvelle clé privée."
    exit 2
  fi
  PROJET_CLE="$(grep -o '"project_id"[[:space:]]*:[[:space:]]*"[^"]*"' "$CLE_FCM" | sed 's/.*"\([^"]*\)"$/\1/')"
  PROJET_APP="$(sed -n 's/^FIREBASE_PROJECT_ID=//p' "$MARQUE_FICHIER" | head -n1)"
  if [ -n "$PROJET_APP" ] && [ "$PROJET_CLE" != "$PROJET_APP" ]; then
    jaune "La clé est du projet Firebase « $PROJET_CLE », l'application de « $PROJET_APP » :"
    jaune "les notifications ne partiront pas. Téléchargez la clé du projet « $PROJET_APP »."
  fi
  poser FCM_SERVICE_ACCOUNT "$FCM_DANS_API"
  vert "notifications instantanées : clé Firebase du projet « ${PROJET_CLE:-?} »"
else
  if [ "$(lire FCM_SERVICE_ACCOUNT)" = "$FCM_DANS_API" ]; then poser FCM_SERVICE_ACCOUNT ""; fi
  if [ -z "$(lire FCM_SERVICE_ACCOUNT)" ]; then
    jaune "Pas de clé Firebase ($ICI/$CLE_FCM) : l'application interrogera le serveur"
    jaune "au lieu de recevoir les notifications. Déposez la clé à cet endroit, puis relancez ce script."
  fi
fi

# Le SITE VITRINE (vitrine/) — SUR SON PROPRE DOMAINE, jamais sous celui de
# l'application, et sans aucun lien entre les deux (demande du propriétaire,
# 09/10/2026). `VITRINE_DOMAIN=exemple.com bash installer-jinan.sh` le pose dans
# .env ; les mises à jour suivantes le gardent. Absent : pas de vitrine.
if [ -n "${VITRINE_DOMAIN:-}" ]; then
  VITRINE_DOMAIN="$(printf '%s' "$VITRINE_DOMAIN" | tr 'A-Z' 'a-z')"
  case "$VITRINE_DOMAIN" in
    *://*|*/*|*' '*|www.*|*.) rouge "VITRINE_DOMAIN : le nom seul, sans https:// ni www. (ex. heavenly-school.com)"; exit 2 ;;
  esac
  case "$VITRINE_DOMAIN" in
    "$PUBLIC_DOMAIN"|*."$PUBLIC_DOMAIN") rouge "VITRINE_DOMAIN doit être un domaine À PART : ni $PUBLIC_DOMAIN, ni l'un de ses sous-domaines."; exit 2 ;;
  esac
  poser VITRINE_DOMAIN "$VITRINE_DOMAIN"
fi
VITRINE_DOMAIN="$(lire VITRINE_DOMAIN)"
mkdir -p "$ICI/caddy-sites"
if [ -n "$VITRINE_DOMAIN" ] && [ -f "$ICI/vitrine/index.html" ]; then
  cat > "$ICI/caddy-sites/vitrine.caddy" <<CADDY
# Écrit par install.sh depuis VITRINE_DOMAIN (.env) — réécrit à chaque mise à jour.
# Le site vitrine : des fichiers statiques, sur leur propre domaine.
www.$VITRINE_DOMAIN {
	redir https://$VITRINE_DOMAIN{uri} permanent
}

$VITRINE_DOMAIN {
	root * /srv/vitrine
	# Les sources et l'outil de construction ne sont pas des pages.
	@prive path /src/* /construire.py /README.md
	respond @prive 404
	@durable path /assets/fonts/* /assets/vendor/* /assets/img/*
	header @durable Cache-Control "public, max-age=2592000"
	header {
		X-Content-Type-Options nosniff
		Referrer-Policy strict-origin-when-cross-origin
		X-Frame-Options SAMEORIGIN
		-Server
	}
	encode zstd gzip
	file_server
}
CADDY
  vert "site vitrine : https://$VITRINE_DOMAIN/ (domaine à part, sans lien avec l'application)"
else
  rm -f "$ICI/caddy-sites/vitrine.caddy"
fi

# ═════════════════════════════════════════════════════════════════════════════
titre "3. Le DNS"
IP_ICI="$(curl -4 -fsS --max-time 6 https://api.ipify.org 2>/dev/null || true)"
[ -n "$IP_ICI" ] || IP_ICI="$(ip -4 route get 1.1.1.1 2>/dev/null | sed -n 's/.* src \([0-9.]*\).*/\1/p')"
DNS_OK=1
NOMS=("$PUBLIC_DOMAIN" "www.$PUBLIC_DOMAIN" "api.$PUBLIC_DOMAIN")
[ -z "$VITRINE_DOMAIN" ] || NOMS+=("$VITRINE_DOMAIN" "www.$VITRINE_DOMAIN")
for h in "${NOMS[@]}"; do
  A="$(getent ahostsv4 "$h" 2>/dev/null | awk '{print $1}' | sort -u | tr '\n' ' ' | sed 's/ $//' || true)"
  case "$h" in "$PUBLIC_DOMAIN"|"$VITRINE_DOMAIN") NOM="@" ;; *) NOM="${h%%.*}" ;; esac
  AAAA="$(getent ahostsv6 "$h" 2>/dev/null | awk '{print $1}' | grep -v '^::ffff:' | sort -u | tr '\n' ' ' | sed 's/ $//' || true)"
  if [ -z "$A" ]; then
    jaune "$h : aucun enregistrement A. À créer : type A, nom « $NOM », valeur $IP_ICI"; DNS_OK=0
  elif [ -n "$IP_ICI" ] && [ "$A" != "$IP_ICI" ]; then
    jaune "$h → $A, alors que ce serveur est $IP_ICI. Corrigez l'enregistrement A."; DNS_OK=0
  else
    vert "$h → $A"
  fi
  if [ -n "$AAAA" ]; then
    # Let's Encrypt préfère l'IPv6 : un AAAA vers ailleurs fait échouer le
    # certificat. Et l'IPv6 arrive aux conteneurs par le relais de Docker, avec
    # l'adresse de la passerelle : tous les parents en IPv6 partageraient une
    # seule adresse, et le verrou de connexion par IP les bloquerait ensemble.
    jaune "$h a un enregistrement AAAA ($AAAA) : SUPPRIMEZ-le (IPv4 seulement)."; DNS_OK=0
  fi
done
if [ "$DNS_OK" -eq 0 ]; then
  jaune "Le DNS n'est pas encore bon : l'installation continue, et Caddy obtiendra les certificats"
  jaune "tout seul dès que ces noms viseront $IP_ICI (quelques minutes à quelques heures)."
fi

# ═════════════════════════════════════════════════════════════════════════════
titre "4. Construction et démarrage (10 à 20 minutes la première fois)"
# ⚠ Une construction ratée ne redémarre rien : le site continue sur les
# images précédentes. Le dire, au lieu d'un arrêt muet sur cette ligne.
if ! docker compose build --quiet; then
  rouge "La construction des images a échoué (message ci-dessus). Rien n'a été redémarré : le site continue sur la version précédente."
  rouge "Causes habituelles : disque plein (df -h), mémoire (free -m), réseau (téléchargement des paquets)."
  exit 3
fi
docker compose up -d db
docker compose run --rm -T api pnpm db:migrate
docker compose exec -T db psql -U postgres -d jinan -v ON_ERROR_STOP=1 \
  -c "ALTER ROLE app_user PASSWORD '${APP_USER_PASSWORD}';" \
  -c "ALTER ROLE app_reporter PASSWORD '${APP_REPORTER_PASSWORD}';" >/dev/null
vert "base à jour, rôles app_user / app_reporter protégés"

# L'école, sur la base neuve — JAMAIS la graine de démonstration (`pnpm seed`
# tronque tout pour poser trois écoles fictives). Le mot de passe provisoire
# n'est lisible que par root.
JOURNAL=/root/jinan-installation.txt
echo "→ l'école « ${SCHOOL_NAME} » (base neuve, sans donnée de démonstration)"
# Le mot de passe choisi (ADMIN_PASSWORD) va au conteneur éphémère, pas dans .env.
MDP=()
[ -n "${ADMIN_PASSWORD:-}" ] && MDP=(-e "ADMIN_PASSWORD=$ADMIN_PASSWORD")
( umask 077
  docker compose run --rm -T "${MDP[@]}" api pnpm --filter @elourwa/db bootstrap-school -- \
    --slug "$SINGLE_SCHOOL_SLUG" --name "$SCHOOL_NAME" --name-ar "$SCHOOL_NAME_AR" \
    --prefix "$SCHOOL_RECEIPT_PREFIX" --admin-email "$ADMIN_EMAIL" --admin-name "$ADMIN_NAME" \
    --hostname "$PUBLIC_DOMAIN" --billing-model services --sync-name | tee "$JOURNAL" )
# `--sync-name` : une école déjà installée prend le nom de .env (ci-dessus) ;
# rien d'autre de l'école ni du compte de direction n'est retouché.
# ⚠ `--billing-model services` : la facturation de Jinan (modes d'étude 8h – 14h /
# 8h – 17h, frais d'inscription par élève, services optionnels — ADR-0073). Posé à
# la création de l'école, jamais changé ensuite ; bootstrap-school est idempotent.
docker compose up -d --remove-orphans
# Caddy : son Caddyfile est un FICHIER monté — remplacé par une mise à jour, le
# conteneur garde l'ancien tant qu'il n'est pas recréé. Les sites de
# caddy-sites/ (un dossier monté) sont vus tout de suite : un rechargement, sans
# coupure, suffit. Un rechargement refusé garde la configuration en service.
if [ "$(docker compose exec -T caddy sha256sum /etc/caddy/Caddyfile 2>/dev/null | cut -d' ' -f1)" != "$(sha256sum Caddyfile | cut -d' ' -f1)" ]; then
  docker compose up -d --force-recreate caddy
elif ! docker compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1; then
  jaune "Caddy n'a pas rechargé sa configuration (docker compose logs --tail=40 caddy) : il garde la précédente."
fi
# Ce que cette construction a remplacé ne sert plus : l'image précédente et le
# cache de plus d'une semaine (~2 Go par mise à jour, jamais retirés jusque-là —
# le disque d'un petit VPS finissait plein). Jamais un volume.
docker image prune -f >/dev/null 2>&1 || true
docker builder prune -f --filter until=168h >/dev/null 2>&1 || true

printf "Attente de l’API"
SANTE=""
for _ in $(seq 1 60); do
  SANTE="$(docker compose exec -T caddy wget -qO- http://api:3001/health 2>/dev/null || true)"
  case "$SANTE" in *'"status":"ok"'*) break ;; esac
  printf '.'; sleep 2
done
echo
case "$SANTE" in
  *'"status":"ok"'*) vert "API en marche : $SANTE" ;;
  *) jaune "L'API ne répond pas encore. Journal : docker compose logs --tail=80 api" ;;
esac

# ═════════════════════════════════════════════════════════════════════════════
titre "5. La sauvegarde nocturne"
chmod 700 "$ICI/sauvegarde.sh"
cat > /etc/cron.d/jinan-sauvegarde <<CRON
# Jinan — base + pièces jointes chaque nuit, 14 jours gardés (voir $ICI/sauvegarde.sh)
30 2 * * * root $ICI/sauvegarde.sh >> /var/log/jinan-sauvegarde.log 2>&1
CRON
chmod 644 /etc/cron.d/jinan-sauvegarde
vert "chaque nuit à 02:30 → /root/sauvegardes-jinan (copiez-les aussi HORS du serveur)"

# Une mise à jour ne crée pas de mot de passe : ne pas renvoyer à un « ci-dessus » vide.
if grep -q 'Mot de passe provisoire' "$JOURNAL" 2>/dev/null; then
  CONNEXION="mot de passe provisoire ci-dessus, À CHANGER à la
                       première connexion (le site l'exige). Copie : ${JOURNAL} (à supprimer)."
else
  CONNEXION="mot de passe inchangé (compte déjà présent : mise à jour)."
fi

VITRINE_LIGNE=""
[ -z "$VITRINE_DOMAIN" ] || VITRINE_LIGNE="
  Site vitrine         https://${VITRINE_DOMAIN}/   (domaine à part, sans lien avec l'application)"

cat <<FIN

═══════════════════════════════════════════════════════════════════════════════
✓ Jinan est en ligne (les certificats HTTPS arrivent dans la minute une fois le DNS en place)

  Site de l'école      https://${PUBLIC_DOMAIN}/
  API (application)    https://api.${PUBLIC_DOMAIN}/health${VITRINE_LIGNE}
  Connexion            ${ADMIN_EMAIL} — ${CONNEXION}

  Pour le Play Store :
    Politique de confidentialité   https://${PUBLIC_DOMAIN}/legal/confidentialite
    Suppression de compte          https://${PUBLIC_DOMAIN}/legal/suppression

  Ensuite, sur le site : Années scolaires → créer l'année → Gestion de scolarité →
  niveaux, classes, matières → Finance → moyens de paiement → Comptes du personnel.

  Journal         docker compose logs -f api web caddy
  Mettre à jour   voir README.md § « Mettre à jour » (on relance ce même script)
═══════════════════════════════════════════════════════════════════════════════
FIN
