#!/usr/bin/env bash
# Démarrage du conteneur Render : migrations, mot de passe d'app_user, graine
# si la base est vide, puis API + site sous surveillance, et le mandataire en
# tête. Idempotent — chaque redéploiement le rejoue.
#
# ⚠ CE SCRIPT NE MEURT PAS. Un déploiement Render n'aboutit que si le
# conteneur ouvre son port et répond à la sonde ; tout ce qui tue le script
# avant — une migration qui refuse, Neon qui dort une seconde de trop, psql qui
# rate — laissait l'ANCIENNE image en service et le déploiement « failed » sans
# que personne ne voie pourquoi. Ici chaque étape est tentée plusieurs fois,
# journalisée, puis on CONTINUE : le mandataire écoute quoi qu'il arrive, l'API
# et le site sont relancés s'ils tombent, et la page d'attente dit la vérité.
#
# Variables attendues (Render → Environment) :
#   DATABASE_ADMIN_URL   le rôle propriétaire de Neon (migrations, graine)
#   APP_USER_PASSWORD    le mot de passe posé sur app_user (généré par Render)
#   JWT_PRIVATE_KEY / JWT_PUBLIC_KEY   (pnpm --filter @elourwa/api keygen)
#   PUBLIC_DOMAIN        ex. elourwa.duckdns.org (les écoles : nour.elourwa.duckdns.org…)
#   ALLOWED_ORIGIN_SUFFIX = PUBLIC_DOMAIN
set -uo pipefail
cd /app

manque=0
for v in DATABASE_ADMIN_URL APP_USER_PASSWORD PUBLIC_DOMAIN JWT_PRIVATE_KEY JWT_PUBLIC_KEY; do
  if [ -z "${!v:-}" ]; then echo "!! variable manquante : $v (Render → Environment)"; manque=1; fi
done
export PORT="${PORT:-10000}"
export ALLOWED_ORIGIN_SUFFIX="${ALLOWED_ORIGIN_SUFFIX:-${PUBLIC_DOMAIN:-}}"
export API_PORT=3001
export UPLOAD_DIR="${UPLOAD_DIR:-/app/uploads}"; mkdir -p "$UPLOAD_DIR" || true

# Le mandataire D'ABORD : le port est ouvert avant toute attente sur la base,
# la sonde de Render voit un conteneur vivant, et un visiteur voit la page
# d'attente au lieu d'un refus de connexion.
node deploy/render/proxy.mjs &
PROXY=$!

# Tenter N fois avec une pause ; rend 0 au premier succès, 1 sinon — sans tuer.
tenter() {
  local essais="$1"; shift
  local n=1
  while true; do
    if "$@"; then return 0; fi
    if [ "$n" -ge "$essais" ]; then echo "!! abandon après $n essais : $*"; return 1; fi
    echo "   échec (essai $n/$essais), nouvel essai dans 10 s : $*"
    sleep 10; n=$((n + 1))
  done
}

if [ "$manque" = "0" ]; then
  # L'URL de l'API = la même base, en app_user (la RLS s'applique : RUNNING.md § 2).
  export DATABASE_URL="$(node -e '
    const u = new URL(process.env.DATABASE_ADMIN_URL);
    u.username = "app_user"; u.password = process.env.APP_USER_PASSWORD;
    process.stdout.write(u.toString());')"

  # RÉINITIALISATION COMPLÈTE, UNE SEULE FOIS PAR VALEUR (décision du
  # propriétaire, 18/09 : « une plateforme neuve »). Poser RESET_DATABASE=<un
  # mot quelconque, ex. la date> dans l'environnement Render : au démarrage
  # suivant, si ce mot diffère de celui gardé dans platform_settings, le schéma
  # est supprimé et recréé (migrations), les rôles reposés, la graine semée ;
  # puis le mot est gardé, et les redémarrages suivants ne touchent plus rien.
  # ⚠ Irréversible : tout ce que la base contenait disparaît.
  # La valeur vient de l'environnement Render, ou du fichier deploy/render/reset-marker
  # du dépôt : changer ce fichier dans un commit remet la base à neuf au déploiement
  # suivant — sans toucher à Render.
  RESET_DATABASE="${RESET_DATABASE:-$(tr -d '[:space:]' < deploy/render/reset-marker 2>/dev/null || true)}"
  if [ -n "${RESET_DATABASE:-}" ]; then
    # ⚠ LA MARQUE DOIT ÊTRE LUE, PAS DEVINÉE. Un psql qui rate (Neon qui dort,
    # table absente) ne vaut pas « marque différente » : ce raccourci remettait
    # la base à neuf sur un simple redémarrage froid. Trois lectures ; si aucune
    # n'aboutit, on ne touche à rien. Une base qui n'a jamais gardé de marque
    # (ligne absente) n'est pas remise à neuf non plus : la marque courante est
    # adoptée après les migrations, et c'est son prochain changement qui comptera.
    lue=0; marque=''
    for essai in 1 2 3; do
      if marque="$(psql "$DATABASE_ADMIN_URL" -v ON_ERROR_STOP=1 -tAc "SELECT value FROM platform_settings WHERE key = 'reset_marker'" 2>>/tmp/demarrage.log)"; then lue=1; break; fi
      echo "   marque illisible (essai $essai/3), nouvel essai dans 10 s"; sleep 10
    done
    if [ "$lue" != "1" ]; then
      echo "!! marque de réinitialisation illisible : la base est laissée telle quelle (voir /tmp/demarrage.log)"
    elif [ -z "$marque" ]; then
      echo "→ aucune marque gardée : pas de réinitialisation, la marque « $RESET_DATABASE » sera adoptée après les migrations"
      ADOPTER_MARQUE=1
    elif [ "$marque" != "$RESET_DATABASE" ]; then
      echo "→ RÉINITIALISATION COMPLÈTE de la base (RESET_DATABASE=$RESET_DATABASE, précédent='$marque')"
      # bash -o pipefail : sans lui le tuyau rend le code de tee (toujours 0) et
      # une remise à neuf ratée après le DROP passait pour réussie.
      if tenter 2 bash -o pipefail -c 'pnpm --filter @elourwa/db reset 2>&1 | tee -a /tmp/demarrage.log'; then
        tenter 3 psql "$DATABASE_ADMIN_URL" -v ON_ERROR_STOP=1 -q <<<"ALTER ROLE app_user PASSWORD '${APP_USER_PASSWORD}';" || true
        if tenter 3 psql "$DATABASE_ADMIN_URL" -v ON_ERROR_STOP=1 -qc "INSERT INTO platform_settings (key, value) VALUES ('reset_marker', '${RESET_DATABASE}') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();"; then
          echo "→ base réinitialisée, marque « $RESET_DATABASE » gardée"
        else
          echo "!! base réinitialisée mais la marque n'a PAS pu être gardée : le prochain démarrage la remettra à neuf de nouveau. Poser la marque à la main."
        fi
      else
        echo "!! la réinitialisation a échoué : la base est laissée telle quelle. Voir le journal."
      fi
    else
      echo "→ RESET_DATABASE inchangé ($marque) : rien à réinitialiser"
    fi
  fi

  echo "→ migrations"
  if tenter 4 bash -o pipefail -c 'pnpm --filter @elourwa/db migrate 2>&1 | tee -a /tmp/demarrage.log'; then
    echo "→ mot de passe de app_user"
    # Sur l'entrée standard : le mot de passe n'apparaît pas dans la ligne de commande.
    tenter 3 psql "$DATABASE_ADMIN_URL" -v ON_ERROR_STOP=1 -q <<<"ALTER ROLE app_user PASSWORD '${APP_USER_PASSWORD}';" || true
    if [ "${ADOPTER_MARQUE:-0}" = "1" ]; then
      psql "$DATABASE_ADMIN_URL" -v ON_ERROR_STOP=1 -qc "INSERT INTO platform_settings (key, value) VALUES ('reset_marker', '${RESET_DATABASE}') ON CONFLICT (key) DO NOTHING;"         && echo "→ marque « $RESET_DATABASE » adoptée" || echo "!! marque non adoptée (sera retentée au prochain démarrage)"
    fi
    ECOLES="$(psql "$DATABASE_ADMIN_URL" -tAc 'SELECT count(*) FROM schools' 2>/dev/null || echo 'x')"
    if [ "${ECOLES:-x}" = "0" ]; then
      echo "→ base vide : graine de démonstration (3 écoles, 600 élèves)"
      tenter 2 pnpm --filter @elourwa/db seed || true
    fi
  else
    echo "!! les migrations n'ont pas abouti : l'API démarre sur le schéma existant. Voir le journal ci-dessus."
  fi
else
  echo "!! démarrage sans base configurée : le mandataire répond, l'API attendra la configuration."
fi

# L'API et le site, relancés s'ils tombent (dix secondes entre deux essais).
surveiller() {
  local nom="$1"; shift
  while true; do
    echo "→ $nom : démarrage"
    "$@"; local code=$?
    echo "!! $nom s'est arrêté (code $code), relance dans 10 s"
    sleep 10
  done
}
# Les sorties sont gardées dans /tmp (le mandataire les sert sur /_journal?cle=…)
# — le journal Render n'est pas lisible depuis l'extérieur, et un processus qui
# tombe en boucle ne se diagnostique pas sans ses dernières lignes.
surveiller API bash -o pipefail -c 'cd apps/api && node dist/main.js 2>&1 | tee -a /tmp/api.log' &
surveiller site bash -o pipefail -c 'cd apps/web && ./node_modules/.bin/next start -p 3000 -H 127.0.0.1 2>&1 | tee -a /tmp/site.log' &

# Le mandataire est le processus de tête : s'il tombe (jamais vu), le conteneur
# redémarre et tout recommence.
wait "$PROXY"
echo "!! le mandataire s'est arrêté"
exit 1
