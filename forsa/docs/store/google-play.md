# Google Play submission — FORSA for Android

Texts: `listing.py`. Graphics: the *Android build* pack (`store-assets/`: 512 px icon, 1024×500 feature graphic,
1080×1920 phone screenshots FR/EN). Upload file: `FORSA-1.0.0.aab`, package `mr.forsa.app`.

## Before the first upload
1. **Play App Signing** (default): upload the `.aab` signed with the provided key — that key becomes your
   *upload key*; Google holds the *app signing key*.
2. Full-screen mode (Trusted Web Activity) checks Digital Asset Links. After the first upload, copy the
   **App signing key certificate SHA-256** from *Play Console → Test and release → App integrity* and add it to the
   server's `.env`, next to the upload key's fingerprint:
   `FORSA_ANDROID_SHA256=13:3C:1C:…:01,<Play app-signing SHA-256>` then restart the API. Without it, apps installed
   from Google Play show a browser address bar.
3. New *personal* developer accounts must run a **closed test with at least 12 testers for 14 days** before they
   can publish to production (organisation accounts are exempt).

## Store listing
| Field | Value |
|---|---|
| App name | `FORSA – Marchés publics` (en-US: `FORSA – Public Tenders`) |
| Category | Business |
| Contact e-mail | your support address |
| Privacy policy | `https://<your server>/privacy` |
| Ads | No ads |
| Target audience | 18 and over (professional tool) |
| Content rating | IARC questionnaire: category *Reference, news or educational* / *Utility*; answer *No* to all content questions → Everyone / PEGI 3 |
| Government app | No |
| Financial features | None |

## App access
All functionality is behind a login. Choose *All or some functionality is restricted* and give:
server address `https://[your-server]`, e-mail and password of a demo account (role *Bid manager*), plus
"The first screen asks for the organisation's FORSA server address".

## Data safety form
* Data collected: **Yes**. Shared with third parties: **No**. Encrypted in transit: **Yes**.
  Users can request deletion: **Yes** (in the app: More → Settings → Profile → Delete my account; and `/privacy`).

| Category → type | Collected | Optional? | Purposes |
|---|---|---|---|
| Personal info → Name | Yes | Required | App functionality, Account management |
| Personal info → Email address | Yes | Required | App functionality, Account management |
| Personal info → User IDs | Yes | Required | App functionality, Account management |
| Files and docs | Yes | Optional | App functionality |
| App activity → Other user-generated content (bids, tasks, assistant questions) | Yes | Optional | App functionality |
| App info and performance, location, audio, contacts, financial, health, messages, photos, web history, device IDs | No | — | — |

Voice dictation uses the phone's speech service (Chrome / Android); FORSA receives text only.
Push notifications use the browser's Web Push service; the endpoint is stored to deliver alerts
(covered by *App functionality*).
