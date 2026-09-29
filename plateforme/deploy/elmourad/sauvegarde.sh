#!/usr/bin/env bash
# SAUVEGARDER EL MOURAD — la base ET les pièces jointes, dans UNE archive datée.
#
#   sudo ./sauvegarde.sh [dossier]      # défaut : /root/sauvegardes-elmourad
#
# Lancé chaque nuit à 02:30 par /etc/cron.d/elmourad-sauvegarde (posé par
# install.sh) ; journal dans /var/log/elmourad-sauvegarde.log. Garde 14 jours
# (GARDER_JOURS=… pour changer).
#
# ⚠ scripts/backup.sh NE CONVIENT PAS à ce déploiement : il veut pg_dump sur la
# machine et une base joignable depuis elle, alors qu'ici Postgres ne vit que
# sur le réseau Docker et les pièces jointes dans un volume. Tout passe donc
# par les conteneurs (`docker compose exec`).
#
# ⚠ LA BASE SEULE N'EST PAS UNE SAUVEGARDE : sans les fichiers, chaque pièce
# jointe restaurée est un lien mort. Les deux voyagent ensemble, avec un
# MANIFEST qui compte les lignes `attachments` et les fichiers.
#
# ⚠ UNE SAUVEGARDE RESTÉE SUR LE SERVEUR NE PROTÈGE PAS DE LA PERTE DU SERVEUR.
# Si `rclone` est installé et configuré, et `RCLONE_DEST` défini dans .env
# (ex. RCLONE_DEST=b2:elmourad-sauvegardes), chaque archive y est aussi copiée.
# Sinon, rapatriez-les régulièrement (scp) sur un autre support.
#
# RESTAURER (sur un serveur installé par install.sh, API et site arrêtés) :
#   tar -xf elmourad-AAAAMMJJ-HHMMSS.tar -C /tmp/restauration
#   docker compose stop api web
#   docker compose exec -T db pg_restore -U postgres -d elmourad --clean --if-exists --no-owner \
#     < /tmp/restauration/database.dump
#   docker compose run --rm --no-deps -T api sh -c 'tar -C /data/uploads -xzf -' \
#     < /tmp/restauration/uploads.tar.gz
#   docker compose up -d
# Faites-le UNE fois pour de vrai, sur un serveur d'essai : une sauvegarde
# jamais restaurée est une hypothèse.
set -euo pipefail
ICI="$(cd "$(dirname "$0")" && pwd)"
cd "$ICI"

DEST="${1:-/root/sauvegardes-elmourad}"
GARDER_JOURS="${GARDER_JOURS:-14}"
STAMP="$(date +%Y%m%d-%H%M%S)"
umask 077
mkdir -p "$DEST"
TRAVAIL="$(mktemp -d)"
trap 'rm -rf "$TRAVAIL"' EXIT

lire() { sed -n "s/^$1=//p" .env 2>/dev/null | tail -n1 | sed -e "s/^'\(.*\)'\$/\1/" -e 's/^"\(.*\)"$/\1/'; }

echo "$(date -u +%FT%TZ) ── sauvegarde El Mourad"

# 1. La base — format « custom » : compressée, restaurable table par table.
docker compose exec -T db pg_dump -U postgres -d elmourad --format=custom --no-owner \
  > "$TRAVAIL/database.dump"

# 2. Les pièces jointes, depuis le volume de l'API — par le conteneur en marche,
#    ou par un conteneur éphémère s'il est arrêté.
if docker compose exec -T api true >/dev/null 2>&1; then
  docker compose exec -T api tar -C /data/uploads -czf - . > "$TRAVAIL/uploads.tar.gz"
else
  docker compose run --rm --no-deps -T api tar -C /data/uploads -czf - . > "$TRAVAIL/uploads.tar.gz"
fi

# 3. Ce que l'archive affirme d'elle-même, pour qu'une restauration se vérifie.
LIGNES="$(docker compose exec -T db psql -U postgres -d elmourad -tAc 'SELECT count(*) FROM attachments' 2>/dev/null | tr -d '[:space:]' || true)"
[ -n "$LIGNES" ] || LIGNES=inconnu
FICHIERS="$(tar -tzf "$TRAVAIL/uploads.tar.gz" | grep -vc '/$' || true)"
cat > "$TRAVAIL/MANIFEST" <<EOF
taken_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
domain=$(lire PUBLIC_DOMAIN)
attachment_rows=$LIGNES
attachment_files=$FICHIERS
database_dump_bytes=$(stat -c %s "$TRAVAIL/database.dump")
EOF

ARCHIVE="$DEST/elmourad-$STAMP.tar"
tar -cf "$ARCHIVE" -C "$TRAVAIL" database.dump uploads.tar.gz MANIFEST
echo "archive : $ARCHIVE ($(du -h "$ARCHIVE" | cut -f1)) — pièces jointes : $LIGNES lignes, $FICHIERS fichiers"
if [ "$LIGNES" != inconnu ] && [ "$LIGNES" != "$FICHIERS" ]; then
  echo "⚠ Les lignes et les fichiers ne correspondent pas : l'archive est gardée, mais vérifiez avant de vous y fier."
fi

# 4. Hors du serveur, si c'est configuré.
DEST_DISTANTE="$(lire RCLONE_DEST)"
if [ -n "$DEST_DISTANTE" ]; then
  if command -v rclone >/dev/null; then
    rclone copy "$ARCHIVE" "$DEST_DISTANTE" && echo "copiée vers $DEST_DISTANTE"
  else
    echo "⚠ RCLONE_DEST est défini mais rclone n'est pas installé : archive gardée sur le serveur seulement."
  fi
fi

# 5. La rotation : les archives de plus de GARDER_JOURS jours partent.
find "$DEST" -maxdepth 1 -name 'elmourad-*.tar' -mtime +"$GARDER_JOURS" -print -delete | sed 's/^/supprimée (ancienne) : /'
