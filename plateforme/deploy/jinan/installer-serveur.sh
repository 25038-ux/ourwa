#!/usr/bin/env bash
# INSTALLER JINAN — À LANCER SUR LE SERVEUR, EN ROOT, EN UNE LIGNE.
#
#   curl -fsSL -o /root/installer-jinan.sh https://raw.githubusercontent.com/25038-ux/ourwa/refs/heads/claude/jinan-web-completion-6wv8c0/plateforme/deploy/jinan/installer-serveur.sh && bash /root/installer-jinan.sh
#
# (Téléchargé PUIS lancé, pas `curl | bash` : apt ou docker pourraient lire
# l'entrée standard et avaler la suite du script.)
#
# Rien à envoyer depuis le PC : le serveur télécharge lui-même le code (dépôt
# public, branche ci-dessous), le pose dans /opt/jinan et lance install.sh
# (Docker, base, école, HTTPS). Le mot de passe provisoire de la direction
# s'affiche à la fin.
#
# Pourquoi : envoyer le zip depuis le PC (scp) échouait (« No such file or
# directory » selon le dossier courant de PowerShell), et tout ce qui suivait
# sur le serveur échouait avec.
#
# Relancer est sans danger : déjà installé, le code est remplacé en gardant
# .env et secrets/ (sauvegarde de la base d'abord), puis install.sh repasse.
set -euo pipefail

DEPOT="${JINAN_DEPOT:-25038-ux/ourwa}"
BRANCHE="${JINAN_BRANCHE:-claude/jinan-web-completion-6wv8c0}"
DOMAINE="${PUBLIC_DOMAIN:-ecole-jinan.com}"
COURRIEL="${ADMIN_EMAIL:-infoheavenly24@gmail.com}"
DIR="${JINAN_DIR:-/opt/jinan}"

ok()    { printf '\033[32m[OK] %s\033[0m\n' "$*"; }
fail()  { printf '\033[31m[X]  %s\033[0m\n' "$*" >&2; exit 2; }
etape() { printf '\n\033[1m== %s ==\033[0m\n' "$*"; }

[ "$(id -u)" -eq 0 ] || fail "Lancez en root (sudo -i, puis la commande)."
if [ "$(hostname -I 2>/dev/null | tr ' ' '\n' | grep -c '^187\.7\.18\.252$')" -gt 0 ]; then
  fail "Ceci est le serveur d'El Mourad : Jinan a son propre VPS."
fi

etape "1/4 Outils"
export DEBIAN_FRONTEND=noninteractive
for outil in curl tar rsync; do
  command -v "$outil" >/dev/null || { apt-get -qq update && apt-get -qq install -y curl tar rsync ca-certificates >/dev/null; break; }
done
ok "curl, tar, rsync"

etape "2/4 Le code ($DEPOT, $BRANCHE)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
# Le commit exact d'abord, puis son archive : ce qui est installé est nommé.
SHA="$(curl -fsSL --retry 3 -H 'Accept: application/vnd.github.sha' "https://api.github.com/repos/$DEPOT/commits/$BRANCHE" 2>/dev/null || true)"
if [[ "$SHA" =~ ^[0-9a-f]{40}$ ]]; then REF="$SHA"; else REF="refs/heads/$BRANCHE"; SHA="(dernier de $BRANCHE)"; fi
curl -fsSL --retry 3 -o "$TMP/src.tgz" "https://codeload.github.com/$DEPOT/tar.gz/$REF" \
  || fail "Téléchargement impossible depuis GitHub (réseau du serveur ?)."
mkdir -p "$TMP/x"
tar -xzf "$TMP/src.tgz" -C "$TMP/x"
SRC="$(find "$TMP/x" -mindepth 2 -maxdepth 2 -type d -name plateforme | head -n1)"
[ -n "$SRC" ] && [ -f "$SRC/deploy/jinan/install.sh" ] || fail "Archive inattendue : plateforme/deploy/jinan/install.sh absent."
printf 'Construit le %s depuis %s\n' "$(date -u +%Y-%m-%dT%H:%MZ)" "$SHA" > "$SRC/VERSION.txt"
ok "$(grep -m1 '^version:' "$SRC/apps/mobile/pubspec.yaml" 2>/dev/null || echo 'version ?') — commit $SHA"

etape "3/4 /opt/jinan"
if [ -f "$DIR/deploy/jinan/.env" ]; then
  # Déjà installé (ou installation interrompue après .env) : sauvegarde si la
  # base tourne, puis le code remplacé en gardant .env et secrets/.
  # (grep sans -q : sous pipefail, -q ferait échouer le tube en silence.)
  if (cd "$DIR/deploy/jinan" && docker compose ps --status running --services 2>/dev/null | grep -x db >/dev/null); then
    (cd "$DIR/deploy/jinan" && bash ./sauvegarde.sh < /dev/null) || fail "La sauvegarde a échoué : rien n'a été remplacé."
    ok "sauvegarde : /root/sauvegardes-jinan"
  fi
  rsync -a --delete --exclude '/deploy/jinan/.env' --exclude '/deploy/jinan/secrets/' "$SRC/" "$DIR/"
  [ -f "$DIR/deploy/jinan/.env" ] || fail ".env a disparu : arrêt."
  ok "code remplacé ; .env et secrets/ gardés"
else
  # Un dossier laissé par un essai précédent (sans .env) est mis de côté, jamais effacé.
  if [ -e "$DIR" ]; then
    ASIDE="$DIR.avant-$(date +%Y%m%d-%H%M%S)-$$"
    mv -T "$DIR" "$ASIDE"
    ok "essai précédent mis de côté : $ASIDE"
  fi
  mv -T "$SRC" "$DIR"
  install -d -m 700 "$DIR/deploy/jinan/secrets"
  ok "code posé dans $DIR"
fi

etape "4/4 Installation (Docker, base, école, HTTPS — 10 à 20 minutes)"
cd "$DIR/deploy/jinan"
PUBLIC_DOMAIN="$DOMAINE" ACME_EMAIL="${ACME_EMAIL:-$COURRIEL}" ADMIN_EMAIL="$COURRIEL" bash ./install.sh < /dev/null

echo
if [ -f /root/jinan-installation.txt ] && grep -q 'Mot de passe provisoire' /root/jinan-installation.txt; then
  echo "  Site      : https://$DOMAINE"
  echo "  Courriel  : $COURRIEL"
  grep 'Mot de passe provisoire' /root/jinan-installation.txt | sed 's/^ */  /'
  echo "  (le site demande un nouveau mot de passe à la première connexion)"
fi
ok "terminé — https://$DOMAINE"
