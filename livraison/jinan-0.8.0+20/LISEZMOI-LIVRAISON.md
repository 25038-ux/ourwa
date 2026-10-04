# Jinan — delivery 0.8.0+20 (4 October 2026)

Everything in this folder belongs together:

| File | What it is | What to do with it |
|---|---|---|
| `jinan-0.8.0+20.zip` | The whole platform (website + API + database migrations), version 0.8.0 | Nothing — the server downloads the same code itself with the update command below. Keep it as an archive. |
| `jinan-parent-0.8.0+20-ESSAI.apk` | The parents' Android app, **test-signed** | Install it on a phone to try the new design and Documents (Android: allow "install unknown apps"). Not for the Play Store. |
| `jinan-parent-0.8.0+20-non-signe.aab` | The parents' Android app for Google Play, **unsigned** | Sign it on your PC with your upload key (step 3), then upload it to Play Console. |
| `jinan-ios-0.8.0+20.zip` | The iOS project (Xcode) | On a Mac: unzip, `bash construire-ios.sh`, then Transporter (see `LISEZMOI-ios` inside). |
| `captures/` | Screenshots of the website and of the app | — |
| `LISEZMOI-jinan.md` | The full server installation / update guide (French) | Reference. |

## 1. Update the live website (one line, on the server, as root)

    curl -fsSL -o /root/installer-jinan.sh https://raw.githubusercontent.com/25038-ux/ourwa/refs/heads/claude/jinan-web-completion-6wv8c0/plateforme/deploy/jinan/installer-serveur.sh && bash /root/installer-jinan.sh

It backs the database up first, keeps `.env` and `secrets/`, rebuilds, and applies
migrations **0048** and **0049** (signed documents). Nothing else to type. At the end it prints the
levels and service prices. It was rehearsed in Docker on a copy of the current
production version with data: everything from before was identical afterwards
(subscriptions, months, payments, receipts).

After the update, the new "Documents" entry appears for the direction and the
secretariat within 15 minutes (when their session renews itself) — or at once after
logging out and in again.

## 2. What is new

**Documents (website, sidebar → "Documents")** — for the direction (super admin,
admin) and the secretariat. Search a family by the parent's name, a child's name, or
any of the family's phone numbers. Open it: every child enrolled this year has one
card per signed document — **Inscription** and **Comportements sociaux** always, then
one per service the child has (cantine, piscine, docteur, transport). There is no
photocopie card (photocopie is still billed as before). Each card:
*Déposer* (PDF or photo, 10 MB max), then *Voir*, *Remplacer*, *Supprimer*. The
family gets a notification and sees the document in the app — read-only: they can
open and download, never change or delete. Give someone the right by giving them the
"Secrétaire" role (Comptes du personnel → Rôles).

**Parents' app 0.8.0** — a new design ("Jardin": emerald, gold, ivory), a side menu
(☰) with every section, and **Documents** in that menu: each child, each document,
"Disponible" or "En attente".

**Fixes**
- *Envoyer un exercice*: Word, Excel, PowerPoint, OpenDocument and RTF files are now
  accepted (the file picker used to grey them out), 10 MB per file instead of 5, and
  several large files at once no longer crash the page (the site cut every upload at
  10 MB). Parents open a Word attachment with the right app.
- *Comptes du personnel*: "Mot de passe" and "Désactiver" answered "Compte introuvable
  dans cette école" for accounts that have a role but no staff record; fixed. Their
  "Fonction" no longer shows "Professeur".
- *Stuck buttons*: every call from the website to the server now has a time limit; a
  button can no longer stay grey forever. For a payment that timed out, the message
  says to reload and check before trying again (never a double payment).
- The red "1 Issue" warnings on list pages (development only) are gone.

## 3. Sign the Play Store bundle (on your PC, PowerShell)

Your upload key stays on your PC (`C:\Eduplateforme\jinan_deployement`). Put the
`.aab` next to `signer-aab.ps1` (in the zip: `plateforme/tools/signer-aab.ps1`) and run:

    powershell -ExecutionPolicy Bypass -File .\signer-aab.ps1

It signs with `jinan-upload.jks` and checks that the certificate is the one Play
expects (SHA-256 `8D:76:DF:…:7E:F2:86`). Upload the signed file in Play Console →
Production (or internal testing) → Create a new release. The version code is **20**.

## 4. Firebase (instant notifications) — when you are ready

1. In the Firebase console of the project **el-mourad**: Add app → Android → package
   `mr.jinan.parent` → register; send me the **App ID** (`1:721820198526:android:…`).
2. Project settings → Service accounts → *Generate new private key* → copy the file
   to the server as `/opt/jinan/deploy/jinan/secrets/fcm-service-account.json`, then
   run the update line of step 1 again.
3. I rebuild the APK/AAB with the App ID; until then the app checks the server
   every few seconds while open (notifications still arrive, just not instantly when
   the app is closed).
