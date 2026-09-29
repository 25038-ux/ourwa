#!/usr/bin/env bash
# METTRE À JOUR LE SERVEUR JINAN DEPUIS CE POSTE — une commande.
#
#   SERVEUR=root@<ip-du-vps-jinan> DOMAINE=<domaine-jinan> bash deploy/jinan/mettre-a-jour.sh
#   (depuis la racine du dépôt, dans Git Bash ; les deux sont OBLIGATOIRES — aucun
#   défaut, pour que Jinan ne parte jamais sur le serveur d'El Mourad)
#
# Ce que fait ce script, dans l'ordre — et ce qu'il ne fait JAMAIS :
#   1. Sur ce poste : vérifie que le dépôt est propre (le zip est `git archive
#      HEAD` : ce qui n'est pas commité ne part pas), construit
#      dist/jinan-<version>.zip (tools/packager.sh zip).
#   2. Vérifie que le serveur a bien une installation (/opt/jinan, .env) —
#      une première installation se fait avec install.sh (README.md), pas ici.
#   3. Envoie le zip dans /root/ du serveur.
#   4. Sur le serveur : SAUVEGARDE d'abord (sauvegarde.sh : base + pièces
#      jointes → /root/sauvegardes-jinan), puis remplace le code de
#      /opt/jinan par celui du zip — SANS toucher à deploy/jinan/.env
#      (mots de passe, clés) ni à deploy/jinan/secrets/ (clé Firebase) —,
#      puis relance install.sh, qui reconstruit les images, applique les
#      migrations et redémarre API, site et Caddy. La base et les pièces
#      jointes vivent dans des volumes Docker : elles ne bougent pas.
#   5. Sur ce poste : interroge https://api.<domaine>/health et le site.
#
#   ⚠ Jamais `docker compose down -v` (le -v efface la base). Jamais de graine
#   de démonstration. Le compte de direction et l'école ne sont pas retouchés
#   (install.sh ne les crée que s'ils n'existent pas).
#
# LA CLÉ SSH. Si une clé publique a été ajoutée au VPS (hPanel → VPS → Clés
# SSH), indiquez où se trouve sa moitié PRIVÉE sur ce poste :
#   CLE_SSH=/c/Users/moi/.ssh/id_ed25519 bash deploy/jinan/mettre-a-jour.sh
# (par défaut : ~/.ssh/id_ed25519 ou ~/.ssh/id_rsa s'ils existent). Sans clé,
# le mot de passe root est demandé deux fois (l'envoi, puis l'exécution).
# ⚠ Cette clé SSH n'a RIEN à voir avec la clé de signature Android
# (apps/mobile/android/jinan-upload.jks), qui ne va jamais sur le serveur.
# Durée : 5 à 15 minutes (la reconstruction des images sur 1 vCPU).
#
# En cas d'échec au milieu : le site précédent continue de tourner tant que
# `docker compose up -d` n'a pas été atteint ; la sauvegarde du début est dans
# /root/sauvegardes-jinan (restauration : en-tête de sauvegarde.sh).
set -euo pipefail

SERVEUR="${SERVEUR:-}"
DOMAINE="${DOMAINE:-}"
if [ -z "$SERVEUR" ] || [ -z "$DOMAINE" ]; then
  echo "✗ SERVEUR=root@<ip-du-vps-jinan> et DOMAINE=<domaine-jinan> sont obligatoires." >&2; exit 2
fi
case "$SERVEUR$DOMAINE" in
  *187.7.18.252*|*elmouradarafat*) echo "✗ C'est le serveur d'El Mourad : Jinan a son propre VPS." >&2; exit 2 ;;
esac
DOSSIER_SERVEUR="/opt/jinan"

vert()  { printf '\033[32m✓ %s\033[0m\n' "$*"; }
jaune() { printf '\033[33m! %s\033[0m\n' "$*"; }
rouge() { printf '\033[31m✗ %s\033[0m\n' "$*" >&2; }
titre() { printf '\n\033[1m── %s ──\033[0m\n' "$*"; }

RACINE="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$RACINE"

# Les options SSH : un délai, et la clé privée si elle est donnée (ou trouvée).
CLE_SSH="${CLE_SSH:-}"
OPTS_SSH=(-o ConnectTimeout=15)
if [ -z "$CLE_SSH" ]; then
  for c in "$HOME/.ssh/id_ed25519" "$HOME/.ssh/id_rsa"; do
    if [ -f "$c" ]; then CLE_SSH="$c"; break; fi
  done
fi
if [ -n "$CLE_SSH" ]; then
  [ -f "$CLE_SSH" ] || { rouge "CLE_SSH=$CLE_SSH : fichier introuvable"; exit 2; }
  OPTS_SSH+=(-i "$CLE_SSH" -o IdentitiesOnly=yes)
fi

# ── 1. Le paquet ─────────────────────────────────────────────────────────────
titre "1. Le paquet (sur ce poste)"
command -v ssh >/dev/null && command -v scp >/dev/null || { rouge "ssh/scp introuvables : lancez ce script dans Git Bash."; exit 2; }
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  rouge "Des changements ne sont pas commités — le zip est « git archive HEAD » et ne les contiendrait pas."
  git status --short --untracked-files=no | head -20 >&2
  exit 2
fi
VERSION="$(sed -n 's/^version: *//p' apps/mobile/pubspec.yaml | head -n1 | tr -d '\r')"
[ -n "$VERSION" ] || { rouge "Version introuvable dans apps/mobile/pubspec.yaml"; exit 2; }
ZIP="dist/jinan-$VERSION.zip"
BRAND=jinan bash tools/packager.sh zip
[ -f "$ZIP" ] || { rouge "Le zip n'a pas été produit : $ZIP"; exit 2; }
COMMIT="$(git rev-parse --short HEAD)"
vert "$ZIP (commit $COMMIT)"

# ── 2. Le serveur est-il installé ? ──────────────────────────────────────────
titre "2. Le serveur ($SERVEUR)"
if ! ssh "${OPTS_SSH[@]}" "$SERVEUR" "test -f $DOSSIER_SERVEUR/deploy/jinan/.env && test -f $DOSSIER_SERVEUR/deploy/jinan/install.sh"; then
  rouge "Pas d'installation Jinan dans $DOSSIER_SERVEUR sur $SERVEUR (ou connexion refusée)."
  rouge "Première installation : deploy/jinan/README.md, § 1 et 2."
  exit 2
fi
vert "installation trouvée dans $DOSSIER_SERVEUR"

# ── 3. L'envoi ───────────────────────────────────────────────────────────────
titre "3. L'envoi du paquet"
scp "${OPTS_SSH[@]}" "$ZIP" "$SERVEUR:/root/jinan-$VERSION.zip"
vert "envoyé : /root/jinan-$VERSION.zip"

# ── 4. La mise à jour, sur le serveur ────────────────────────────────────────
titre "4. La mise à jour (sur le serveur)"
# Le script distant est passé sur l'entrée standard, entre apostrophes : rien
# n'y est interprété ici ; la version et le commit arrivent en arguments.
ssh "${OPTS_SSH[@]}" "$SERVEUR" bash -s -- "$VERSION" "$COMMIT" "$DOSSIER_SERVEUR" <<'DISTANT'
set -euo pipefail
VERSION="$1"; COMMIT="$2"; DOSSIER="$3"
vert()  { printf '\033[32m✓ %s\033[0m\n' "$*"; }
rouge() { printf '\033[31m✗ %s\033[0m\n' "$*" >&2; }
[ "$(id -u)" -eq 0 ] || { rouge "Connectez-vous en root (ou avec sudo)."; exit 2; }
command -v unzip >/dev/null || apt-get -qq install -y unzip >/dev/null
command -v rsync >/dev/null || apt-get -qq install -y rsync >/dev/null

cd "$DOSSIER/deploy/jinan"
echo "→ sauvegarde avant la mise à jour (base + pièces jointes)"
bash ./sauvegarde.sh < /dev/null
vert "sauvegarde faite : /root/sauvegardes-jinan"

rm -rf /tmp/maj-jinan && mkdir -p /tmp/maj-jinan
unzip -q "/root/jinan-$VERSION.zip" -d /tmp/maj-jinan
SOURCE="/tmp/maj-jinan/jinan-$VERSION"
[ -f "$SOURCE/deploy/jinan/install.sh" ] || { rouge "Zip inattendu : $SOURCE/deploy/jinan/install.sh manque."; exit 2; }

# Le code est remplacé ; .env et secrets/ restent (ancrés à la racine du transfert).
rsync -a --delete \
  --exclude '/deploy/jinan/.env' \
  --exclude '/deploy/jinan/secrets/' \
  "$SOURCE/" "$DOSSIER/"
printf '%s — commit %s — mis à jour le %s\n' "$VERSION" "$COMMIT" "$(date -u +%FT%TZ)" > "$DOSSIER/VERSION.txt"
vert "code remplacé par $VERSION ($COMMIT) ; .env et secrets/ conservés"

cd "$DOSSIER/deploy/jinan"
bash ./install.sh < /dev/null
rm -rf /tmp/maj-jinan
vert "install.sh terminé"
DISTANT

# ── 5. Vérification ──────────────────────────────────────────────────────────
titre "5. Vérification (depuis ce poste)"
SANTE="$(curl -fsS --max-time 30 "https://api.$DOMAINE/health" || true)"
case "$SANTE" in
  *'"status":"ok"'*) vert "API : $SANTE" ;;
  *) jaune "L'API ne répond pas encore « ok » : $SANTE — sur le serveur : cd $DOSSIER_SERVEUR/deploy/jinan && docker compose logs --tail=80 api" ;;
esac
CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 30 "https://$DOMAINE/login" || true)"
if [ "$CODE" = "200" ]; then vert "site : https://$DOMAINE/login répond 200"
else jaune "site : https://$DOMAINE/login répond « $CODE »"; fi

cat <<FIN

✓ Jinan $VERSION ($COMMIT) est déployé sur $DOMAINE.
  Sauvegarde d'avant la mise à jour : /root/sauvegardes-jinan (sur le serveur).
  Journal : ssh $SERVEUR 'cd $DOSSIER_SERVEUR/deploy/jinan && docker compose logs -f api web'
FIN
