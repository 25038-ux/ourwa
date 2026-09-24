# App Store submission — FORSA for iPhone

Texts: `listing.py` (FR primary, EN). Screenshots: the *iOS attachments* pack (`screenshots/6.9in`, `6.5in`).
Build: `.github/workflows/forsa-ios.yml` → *signed* job (see `ios/README.md`).

## App information
| Field | Value |
|---|---|
| Bundle ID | `mr.forsa.app` |
| SKU | `forsa-ios` (anything unique) |
| Primary language | French |
| Category | Business (secondary: Productivity) |
| Price | Free — no in-app purchase (organisations subscribe directly with the operator) |
| Privacy policy URL | `https://<your server>/privacy` |
| Support URL | `https://<your server>/` or your company website |
| Copyright | `2026 <your company>` |
| Age rating | 4+ — answer *None* to every content question; *Unrestricted web access: No* (the app only shows your FORSA server; other links open in Safari) |
| Export compliance | Uses only standard HTTPS → exempt (`ITSAppUsesNonExemptEncryption = NO` is already in the app) |
| Sign in with Apple | Not required (no third-party login) |

## App Privacy ("nutrition label")
*Do you or your partners use data to track?* **No.**

| Data type | Collected | Linked to the user | Purpose |
|---|---|---|---|
| Contact info → Name, Email address | Yes | Yes | App functionality |
| User content → Other user content (company profile, uploaded documents, bids, assistant questions) | Yes | Yes | App functionality |
| Identifiers → User ID | Yes | Yes | App functionality |
| Other data → security log (sign-in time, IP address) | Yes | Yes | App functionality (account security) |
| Audio, location, contacts, health, financial info, browsing history, diagnostics, advertising data | **No** | — | — |

Voice dictation is transcribed by the device's speech service; FORSA receives text only.

## Account deletion (guideline 5.1.1(v))
In the app: **More → Settings → Profile → Delete my account** (password confirmation). The web page `/privacy`
explains what is erased.

## App Review notes (copy, fill the brackets)
```
FORSA is a business-to-business service that helps companies find and prepare public procurement bids
(Mauritania's national procurement portal, World Bank, UN). Each customer organisation runs its own FORSA
server; the first screen asks for the server address.

Demo access
  Server address: https://[your-server]
  Email:          [reviewer account email]
  Password:       [password]

Suggested path: Today → Opportunities → open one (explained fit score) → Market (who wins what) →
the green centre button opens the assistant (type or tap the microphone) → Bids.

Microphone: used only when the user taps the microphone in the assistant (voice dictation).
Account deletion: More → Settings → Profile → Delete my account.
No purchases in the app; organisations subscribe directly under a business contract.
```
Create the reviewer account in your organisation (web: **Team → Invite**, role *Bid manager* (the *Reviewer* role is read-only)). The server
must be reachable from the internet with a valid HTTPS certificate while the review runs.

## Things Apple may push back on
* **4.2 Minimum functionality** — the app is a native shell around the web app. Its native parts (server setup,
  voice, calendar/Quick Look, haptics, offline screen, quick action) are the argument; the decision is Apple's.
* **2.1 App completeness** — the demo account must work and show data (let the first source sync finish).
* Screenshots must show the app in use: the 6.9" set is required, 6.5" is optional.
