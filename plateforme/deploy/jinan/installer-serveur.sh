#!/usr/bin/env bash
# INSTALLER JINAN — À LANCER SUR LE SERVEUR, EN ROOT, EN UNE LIGNE.
#
#   curl -fSL -o /root/installer-jinan.sh https://raw.githubusercontent.com/25038-ux/ourwa/refs/heads/claude/jinan-web-completion-6wv8c0/plateforme/deploy/jinan/installer-serveur.sh && bash /root/installer-jinan.sh
#
# (`-fSL`, pas `-fsSL` : un téléchargement raté le DIT. Avec `-s`, curl se
# taisait et rien ne se passait — « the update script didn't work at all ».)
# Déjà téléchargé une fois ? `bash /root/installer-jinan.sh` suffit : c'est lui
# qui télécharge la dernière version du code.
#
# TOUT EST JOURNALISÉ dans /root/installer-jinan.log. En cas d'échec : l'étape
# est nommée, le site continue sur la version précédente, et
# `tail -40 /root/installer-jinan.log` dit pourquoi.
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
warn()  { printf '\033[33m[!]  %s\033[0m\n' "$*"; }
fail()  { printf '\033[31m[X]  %s\033[0m\n' "$*" >&2; exit 2; }
ETAPE="démarrage"
etape() { ETAPE="$*"; printf '\n\033[1m== %s ==\033[0m\n' "$*"; }

# Le journal : tout ce qui s'affiche y va aussi (5 Mo au plus, l'ancien gardé).
JOURNAL_MAJ=/root/installer-jinan.log
if [ -w /root ]; then
  [ -f "$JOURNAL_MAJ" ] && [ "$(stat -c %s "$JOURNAL_MAJ" 2>/dev/null || echo 0)" -gt 5000000 ] && mv -f "$JOURNAL_MAJ" "$JOURNAL_MAJ.1"
  exec > >(tee -a "$JOURNAL_MAJ") 2>&1
  printf '\n──── %s ────\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
fi
TMP=""
# ⚠ UN ÉCHEC DIT OÙ, ET CE QUI TOURNE ENCORE. Avant : le script s'arrêtait
# sur la ligne fautive, sans un mot de plus.
fin() {
  local code=$?
  [ -n "$TMP" ] && rm -rf "$TMP"
  if [ "$code" -ne 0 ]; then
    printf '\n\033[31m[X]  Arrêt pendant « %s » (code %s).\033[0m\n' "$ETAPE" "$code"
    echo "     Le site continue de tourner sur la version précédente (rien n'est redémarré avant la fin de la construction)."
    echo "     Pourquoi : tail -40 $JOURNAL_MAJ   (photo ou copie de ces lignes)"
  fi
}
trap fin EXIT

espace_libre_go() { { df -BG --output=avail "$1" 2>/dev/null | tail -1 | tr -dc '0-9'; } || true; }

[ "$(id -u)" -eq 0 ] || fail "Lancez en root (sudo -i, puis la commande)."
if [ "$(hostname -I 2>/dev/null | tr ' ' '\n' | grep -c '^187\.7\.18\.252$')" -gt 0 ]; then
  fail "Ceci est le serveur d'El Mourad : Jinan a son propre VPS."
fi

etape "0/4 Disque et mémoire"
# ⚠ CHAQUE MISE À JOUR LAISSAIT ~2 Go (l'ancienne image, le cache de
# construction) et rien ne les retirait : au bout de quelques mises à jour,
# le disque d'un petit VPS est plein et la construction échoue. Sous le seuil,
# on retire ce qui ne sert plus — jamais une image en service, jamais un
# volume (la base, les fichiers) — puis on vérifie.
MIN_GO="${JINAN_ESPACE_MIN_GO:-6}"
CIBLE=/var/lib/docker; [ -d "$CIBLE" ] || CIBLE=/
LIBRE="$(espace_libre_go "$CIBLE")"
if [ -n "$LIBRE" ] && [ "$LIBRE" -lt "$MIN_GO" ] && command -v docker >/dev/null; then
  warn "Seulement ${LIBRE} Go libres : nettoyage des anciennes images Docker et du cache de construction…"
  docker image prune -f >/dev/null 2>&1 || true
  docker builder prune -af >/dev/null 2>&1 || true
  journalctl --vacuum-size=200M >/dev/null 2>&1 || true
  apt-get clean >/dev/null 2>&1 || true
  LIBRE="$(espace_libre_go "$CIBLE")"
fi
if [ -n "$LIBRE" ] && [ "$LIBRE" -lt "$MIN_GO" ]; then
  df -h / "$CIBLE" 2>/dev/null | sed 's/^/     /'
  du -sh /root/sauvegardes-jinan /opt/jinan.avant-* 2>/dev/null | sed 's/^/     /' || true
  fail "Disque presque plein : ${LIBRE} Go libres, il en faut ${MIN_GO}. Les sauvegardes et les anciens dossiers ci-dessus peuvent être déplacés hors du serveur."
fi
MEM_MO="$( { free -m 2>/dev/null | awk '/^Mem:/ {print $2}'; } || true)"
SWAP_MO="$( { free -m 2>/dev/null | awk '/^Swap:/ {print $2}'; } || true)"
ok "disque : ${LIBRE:-?} Go libres ; mémoire : ${MEM_MO:-?} Mo + échange ${SWAP_MO:-?} Mo"

etape "1/4 Outils"
export DEBIAN_FRONTEND=noninteractive
for outil in curl tar rsync; do
  command -v "$outil" >/dev/null || { apt-get -qq update && apt-get -qq install -y curl tar rsync ca-certificates >/dev/null; break; }
done
ok "curl, tar, rsync"

etape "2/4 Le code ($DEPOT, $BRANCHE)"
TMP="$(mktemp -d)"
# Le commit exact d'abord, puis son archive : ce qui est installé est nommé.
SHA="$(curl -fsSL --retry 3 -H 'Accept: application/vnd.github.sha' "https://api.github.com/repos/$DEPOT/commits/$BRANCHE" 2>/dev/null || true)"
if [[ "$SHA" =~ ^[0-9a-f]{40}$ ]]; then REF="$SHA"; else REF="refs/heads/$BRANCHE"; SHA="(dernier de $BRANCHE)"; fi
curl -fSL --retry 3 -o "$TMP/src.tgz" "https://codeload.github.com/$DEPOT/tar.gz/$REF" \
  || fail "Téléchargement impossible depuis GitHub (réseau du serveur ?)."
mkdir -p "$TMP/x"
tar -xzf "$TMP/src.tgz" -C "$TMP/x" || fail "Archive illisible (téléchargement interrompu ? disque plein ?) : relancez."

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
    (cd "$DIR/deploy/jinan" && bash ./sauvegarde.sh < /dev/null) || fail "La sauvegarde a échoué (voir ci-dessus) : rien n'a été remplacé, le site tourne comme avant."
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
  mkdir -p "$(dirname "$DIR")"
  mv -T "$SRC" "$DIR"
  install -d -m 700 "$DIR/deploy/jinan/secrets"
  PREMIERE=1
  ok "code posé dans $DIR"
fi

etape "4/4 Installation (Docker, base, école, HTTPS — 10 à 20 minutes)"
cd "$DIR/deploy/jinan"
PUBLIC_DOMAIN="$DOMAINE" ACME_EMAIL="${ACME_EMAIL:-$COURRIEL}" ADMIN_EMAIL="$COURRIEL" bash ./install.sh < /dev/null

echo
# Les niveaux, par cycle : ce que la page « Niveaux » affiche, lisible ici sans
# se connecter au site (0046 a classé ceux de Jinan le 30/09/2026).
echo "  Niveaux (cycle · rang · nom) — à changer dans Gestion de scolarité → Niveaux :"
( cd "$DIR/deploy/jinan" && docker compose exec -T db psql -U postgres -d jinan -At -F ' · ' \
    -c "SELECT cycle, sort_order, name FROM levels ORDER BY cycle, sort_order, name" 2>/dev/null | sed 's/^/    /' ) || true
echo
# Les prix des services de l'année active (page « Frais ») — et l'alerte qui
# compte depuis le 04/10/2026 (ADR-0079) : la photocopie est d'office ; sans
# prix, CHAQUE inscription est refusée jusqu'à ce qu'on le pose.
PRIX="$(cd "$DIR/deploy/jinan" && docker compose exec -T db psql -U postgres -d jinan -At -F ' · ' \
    -c "SELECT y.label, COALESCE(sp.service, '-'), COALESCE(sp.amount::text, '-')
          FROM academic_years y LEFT JOIN service_prices sp ON sp.academic_year_id = y.id
         WHERE y.status = 'active' ORDER BY sp.service" 2>/dev/null || true)"
if [ -n "$PRIX" ]; then
  echo "  Prix des services de l'année active (année · service · MRU) — page « Frais » :"
  printf '%s\n' "$PRIX" | sed 's/^/    /'
  if ! printf '%s\n' "$PRIX" | grep -q ' · photocopie · '; then
    printf '\033[33m  ⚠ Le prix de la photocopie n’est pas défini : elle est désormais obligatoire,\n'
    printf '    et chaque inscription sera REFUSÉE tant qu’il manque. Posez-le dans « Frais » (0 = gratuit).\033[0m\n'
  fi
  echo
fi
# Le mot de passe provisoire : à la PREMIÈRE installation seulement (le fichier
# reste sur le serveur, et une mise à jour ne doit pas réafficher un vieux mot de passe).
if [ "${PREMIERE:-0}" = 1 ] && [ -f /root/jinan-installation.txt ] && grep -q 'Mot de passe provisoire' /root/jinan-installation.txt; then
  echo "  Site      : https://$DOMAINE"
  echo "  Courriel  : $COURRIEL"
  grep 'Mot de passe provisoire' /root/jinan-installation.txt | sed 's/^ */  /'
  echo "  (le site demande un nouveau mot de passe à la première connexion)"
fi
ok "terminé — https://$DOMAINE"
