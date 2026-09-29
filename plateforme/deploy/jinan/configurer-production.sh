#!/usr/bin/env bash
# DONNER À JINAN SON SERVEUR ET SON DOMAINE DE PRODUCTION — une fois.
#
#   bash deploy/jinan/configurer-production.sh <ip-du-vps> <domaine> [hébergeur]
#   ex. bash deploy/jinan/configurer-production.sh 203.0.113.10 jinan-ecole.com namecheap-eu
#
#   [hébergeur] (facultatif) — celui que la politique de confidentialité nomme
#   (LEGAL_HOST) : namecheap-eu, namecheap-us, hostinger-eu. Sans lui, rien ne
#   change (défaut d'install.sh : Hostinger, UE).
#
# Ce que fait ce script (sur ce poste, rien sur le serveur) :
#   1. vérifie l'adresse IPv4 et le domaine (le nom seul : ni https://, ni www.,
#      ni api.) — et REFUSE le serveur et le domaine d'El Mourad ;
#   2. écrit deploy/jinan/production.env (JINAN_IP, JINAN_DOMAINE), que lisent
#      mettre-a-jour.sh / mettre-a-jour.ps1 / install.sh quand on ne leur donne
#      rien ;
#   3. écrit API_URL=https://api.<domaine> et WEB_URL=https://<domaine> dans
#      deploy/brands/jinan.env — l'application Android les compile ; sans elles
#      `packager.sh android` refuse de construire ;
#   4. écrit l'hébergeur (LEGAL_HOST, LEGAL_HOST_AR) s'il est donné ;
#   5. dit quels enregistrements DNS créer, et vérifie ceux qui existent déjà.
#
# Relançable : un autre domaine ou une autre IP remplacent les précédents.
# Ensuite : commiter les deux fichiers, puis l'installation (README.md §1–§2)
# ou la mise à jour (sans arguments : elle lit production.env).
set -euo pipefail

vert()  { printf '\033[32m✓ %s\033[0m\n' "$*"; }
jaune() { printf '\033[33m! %s\033[0m\n' "$*"; }
rouge() { printf '\033[31m✗ %s\033[0m\n' "$*" >&2; }

IP="${1:-}"
DOMAINE="$(printf '%s' "${2:-}" | tr 'A-Z' 'a-z')"
HEBERGEUR="${3:-}"
case "$HEBERGEUR" in
  '') HOTE=''; HOTE_AR='' ;;
  namecheap-eu) HOTE='Namecheap, Inc. — serveur situé dans l’Union européenne'; HOTE_AR='Namecheap, Inc. — خادم في الاتحاد الأوروبي' ;;
  namecheap-us) HOTE='Namecheap, Inc. — serveur situé aux États-Unis'; HOTE_AR='Namecheap, Inc. — خادم في الولايات المتحدة' ;;
  hostinger-eu) HOTE='Hostinger International Ltd — serveur situé dans l’Union européenne'; HOTE_AR='Hostinger International Ltd — خادم في الاتحاد الأوروبي' ;;
  *) printf '\033[31m✗ Hébergeur « %s » inconnu : namecheap-eu, namecheap-us ou hostinger-eu.\033[0m\n' "$HEBERGEUR" >&2; exit 2 ;;
esac
if [ -z "$IP" ] || [ -z "$DOMAINE" ]; then
  rouge "Usage : bash deploy/jinan/configurer-production.sh <ip-du-vps> <domaine>"
  exit 2
fi

# ── 1. Vérifier ─────────────────────────────────────────────────────────────
if ! printf '%s' "$IP" | grep -Eq '^([0-9]{1,3}\.){3}[0-9]{1,3}$'; then
  rouge "« $IP » n'est pas une adresse IPv4 (ex. 203.0.113.10)."; exit 2
fi
IFS=. read -r a b c d <<<"$IP"
for o in "$a" "$b" "$c" "$d"; do
  if [ "$o" -gt 255 ]; then rouge "« $IP » : chaque nombre va de 0 à 255."; exit 2; fi
done
case "$IP" in
  10.*|127.*|192.168.*|0.*|169.254.*) rouge "« $IP » est une adresse privée : donnez l'IP publique du VPS."; exit 2 ;;
esac
if [ "$a" -eq 172 ] && [ "$b" -ge 16 ] && [ "$b" -le 31 ]; then
  rouge "« $IP » est une adresse privée : donnez l'IP publique du VPS."; exit 2
fi
case "$DOMAINE" in
  *://*|*/*|*' '*|www.*|api.*) rouge "Le domaine seul, sans https://, sans www. ni api. (ex. jinan-ecole.com)."; exit 2 ;;
esac
if ! printf '%s' "$DOMAINE" | grep -Eq '^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$'; then
  rouge "« $DOMAINE » n'est pas un nom de domaine (ex. jinan-ecole.com)."; exit 2
fi
# ⚠ Jamais le serveur d'El Mourad : les deux piles prendraient les mêmes ports
# 80/443, et deux écoles partageraient un compte root (README.md).
case "$IP $DOMAINE" in
  *187.7.18.252*|*elmouradarafat*) rouge "C'est le serveur ou le domaine d'El Mourad : Jinan a son propre VPS."; exit 2 ;;
esac

RACINE="$(cd "$(dirname "$0")/../.." && pwd)"
PROD="$RACINE/deploy/jinan/production.env"
MARQUE="$RACINE/deploy/brands/jinan.env"

# ── 2. production.env ───────────────────────────────────────────────────────
tmp="$(mktemp)"
sed -e "s|^JINAN_IP=.*|JINAN_IP=$IP|" -e "s|^JINAN_DOMAINE=.*|JINAN_DOMAINE=$DOMAINE|" "$PROD" >"$tmp"
mv "$tmp" "$PROD"
vert "deploy/jinan/production.env : $IP · $DOMAINE"

# ── 3. L'adresse compilée dans l'application ────────────────────────────────
tmp="$(mktemp)"
# Relancé : l'ancienne adresse (et sa ligne de commentaire) part, la nouvelle
# s'écrit à la fin ; `cat -s` resserre les lignes vides.
grep -v -E '^(API_URL|WEB_URL)=|^# Le serveur de production \(configurer-production\.sh\)' "$MARQUE" | cat -s >"$tmp"
{
  cat "$tmp"
  echo ""
  echo "# Le serveur de production (configurer-production.sh) : compilé dans l'application."
  echo "API_URL=https://api.$DOMAINE"
  echo "WEB_URL=https://$DOMAINE"
} >"$MARQUE"
rm -f "$tmp"
vert "deploy/brands/jinan.env : API_URL=https://api.$DOMAINE, WEB_URL=https://$DOMAINE"

# ── 4. L'hébergeur des pages légales ────────────────────────────────────────
if [ -n "$HOTE" ]; then
  tmp="$(mktemp)"
  grep -v -E '^(LEGAL_HOST|LEGAL_HOST_AR)=' "$MARQUE" | cat -s >"$tmp"
  { cat "$tmp"; echo "LEGAL_HOST=\"$HOTE\""; echo "LEGAL_HOST_AR=\"$HOTE_AR\""; } >"$MARQUE"
  rm -f "$tmp"
  vert "deploy/brands/jinan.env : LEGAL_HOST=$HOTE"
  jaune "Serveur déjà installé ? .env garde l'ancien texte : sur le serveur, LEGAL_HOST=… dans deploy/jinan/.env, puis docker compose up -d web."
fi

# ── 5. Le DNS ───────────────────────────────────────────────────────────────
echo ""
echo "Chez le registraire du domaine, trois enregistrements A (et AUCUN AAAA) :"
printf '    %-5s A  %s\n' '@' "$IP" 'www' "$IP" 'api' "$IP"
resoudre() {
  if command -v getent >/dev/null 2>&1; then getent ahostsv4 "$1" 2>/dev/null | awk '{print $1; exit}'
  elif command -v nslookup >/dev/null 2>&1; then nslookup "$1" 2>/dev/null | awk '/^Address/ && !/#/ {print $2}' | tail -1
  fi
}
for h in "$DOMAINE" "www.$DOMAINE" "api.$DOMAINE"; do
  r="$(resoudre "$h" || true)"
  if [ -z "$r" ]; then jaune "$h : ne répond pas encore (DNS pas créé ou pas propagé)."
  elif [ "$r" = "$IP" ]; then vert "$h → $IP"
  else jaune "$h → $r, pas $IP : corrigez l'enregistrement A."
  fi
done

cat <<EOF

Ensuite :
  1. git add deploy/jinan/production.env deploy/brands/jinan.env && git commit -m "Jinan : serveur de production"
  2. Première installation : deploy/jinan/README.md §1–§2 (le domaine est lu ici).
  3. Mises à jour : SANS arguments, elles lisent production.env —
       bash deploy/jinan/mettre-a-jour.sh                      (Git Bash)
       powershell -ExecutionPolicy Bypass -File .\\mettre-a-jour.ps1   (PowerShell)
  4. L'application : BRAND=jinan bash tools/packager.sh android
EOF
