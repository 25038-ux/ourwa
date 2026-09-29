#!/usr/bin/env bash
# SIGNER UN .aab AVEC LA CLÉ DE TÉLÉVERSEMENT DE L'ENSEIGNE — sur le poste qui la détient.
#
#   BRAND=jinan bash tools/signer-aab.sh dist/jinan-parent-0.7.8+18-non-signe.aab
#   → dist/jinan-parent-0.7.8+18.aab : signé, vérifié, son empreinte affichée.
#
# Pourquoi : la clé de téléversement (apps/mobile/android/<enseigne>-upload.jks +
# key-<enseigne>.properties) ne quitte jamais le poste de l'école. Un .aab
# construit ailleurs (sans elle) arrive NON SIGNÉ ; ce script le signe ici, avec
# `jarsigner` (JDK), comme Google le documente pour un app bundle. Aucune
# reconstruction Flutter.
#
# ⚠ L'empreinte SHA-256 affichée doit être celle de la clé enregistrée pour
# l'application dans la Play Console (Jinan : 8D:76:DF:C8:…:CE:7E:F2:86) :
# un .aab signé d'une autre clé y est refusé.
set -euo pipefail

vert()  { printf '\033[32m✓ %s\033[0m\n' "$*"; }
rouge() { printf '\033[31m✗ %s\033[0m\n' "$*" >&2; }

ENTREE="${1:-}"
[ -n "${BRAND:-}" ] || { rouge "BRAND=<enseigne> est obligatoire (ex. BRAND=jinan)."; exit 2; }
[ -f "$ENTREE" ] || { rouge "Usage : BRAND=$BRAND bash tools/signer-aab.sh <fichier-non-signe.aab>"; exit 2; }

RACINE="$(cd "$(dirname "$0")/.." && pwd)"
PROPS="$RACINE/apps/mobile/android/key-$BRAND.properties"
[ -f "$PROPS" ] || { rouge "$PROPS introuvable : la clé de $BRAND n'est pas sur ce poste."; exit 2; }
val() { sed -n "s/^$1=//p" "$PROPS" | tr -d '\r' | tail -n1; }
ALIAS="$(val keyAlias)"; STOREPASS="$(val storePassword)"; KEYPASS="$(val keyPassword)"; STORE="$(val storeFile)"
# storeFile est relatif au module app (apps/mobile/android/app), comme Gradle le lit.
case "$STORE" in /*|?:*) ;; *) STORE="$RACINE/apps/mobile/android/app/$STORE" ;; esac
[ -f "$STORE" ] || { rouge "Le magasin de clés $STORE est introuvable."; exit 2; }

outil() {
  if command -v "$1" >/dev/null 2>&1; then command -v "$1"; return; fi
  ls -d /c/Java/jdk-17*/bin/"$1".exe 2>/dev/null | head -1
}
JARSIGNER="$(outil jarsigner)"; KEYTOOL="$(outil keytool)"
[ -n "$JARSIGNER" ] && [ -n "$KEYTOOL" ] || { rouge "jarsigner/keytool introuvables : installez le JDK (tools/android-sdk.sh)."; exit 2; }

# Un .aab déjà signé porterait deux signatures : refusé par le Play Store.
if unzip -l "$ENTREE" 2>/dev/null | grep -qE 'META-INF/[^/]+\.(SF|RSA|EC|DSA)$'; then
  rouge "$ENTREE est déjà signé : partez du fichier « -non-signe »."; exit 2
fi

SORTIE="${ENTREE%-non-signe.aab}.aab"
[ "$SORTIE" != "$ENTREE" ] || SORTIE="${ENTREE%.aab}-signe.aab"
"$JARSIGNER" -keystore "$STORE" -storepass "$STOREPASS" -keypass "$KEYPASS" \
  -sigalg SHA256withRSA -digestalg SHA-256 -signedjar "$SORTIE" "$ENTREE" "$ALIAS" >/dev/null
"$JARSIGNER" -verify "$SORTIE" >/dev/null || { rouge "La vérification de la signature a échoué."; exit 1; }
EMPREINTE="$("$KEYTOOL" -list -v -keystore "$STORE" -storepass "$STOREPASS" -alias "$ALIAS" 2>/dev/null \
  | tr -d '\r' | sed -n 's/^[[:space:]]*SHA256: //p' | head -1)"
vert "$SORTIE — signé avec « $ALIAS »"
echo "  Empreinte SHA-256 : $EMPREINTE"
echo "  → Play Console : Tester et publier → Test fermé → Créer une version → importer ce fichier."
