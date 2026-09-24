# Source registry — verification log

Machine-readable registry: `sources/registry.yaml`. This file records **what has been verified, when and how**.
No connector may be activated without a dated verification entry here (spec §106).

| Source | Registry id | Status | Verified | Access |
|---|---|---|---|---|
| Portail National des Marchés Publics (MR) | `mr-armp-portal` | **active** | 2026-09-24 | Public JSON API of the portal (no auth) |
| World Bank procurement notices | `worldbank-procurement-notices` | **active** | 2026-09-24 | Official Search API, CC BY 4.0 |
| UNGM notices | `ungm-notices` | **active, credential-gated** (AUTH_REQUIRED) | 2026-09-24 | Official OAuth 2.0 API |
| FORSA demo | `forsa-demo` | active | — | Synthetic fixtures |

---

## 1. Portail National des Marchés Publics — marchespublics.gov.mr (verified 2026-09-24)

**How the site works.** A Next.js front-end; every public page loads its data from unauthenticated JSON endpoints
under `https://marchespublics.gov.mr/api/…` (found in the site's own JavaScript bundles). No login, CAPTCHA or bot
protection is involved for public pages.

| Endpoint | Content | Observed |
|---|---|---|
| `/api/annonces?limit=&offset=` | Published notices: `titreFr`, `titreAr`, `autorite` (buyer FR/AR), `datePUB`, `file.fileLink` (official PDF), `validated` | `totalCount` 88 |
| `/api/activities/forSite?limit=&offset=` | Procurement-plan (PPM) lines: `realisation`, `types.titre` (Travaux/Fournitures/Services courants/Prestations intellectuelles), `modeselection` (AOON, AOOI, ED…), `datelancement`, `dateattribution`, `montant.montantMRU` (often 0), `ppm.reference` | `totalCount` 4,422 |
| `/api/ppm/forSite`, `/api/paa/forSite` | Plan documents (PPM 559, PAA 455) | not ingested (the activities feed carries the lines) |
| `/api/avisgenerale` | General procurement notices (80) | not ingested — **embeds portal-staff records (email, phone, password hash)** |
| `/api/listerouge` | « Liste rouge »: excluded companies (`entreprise`, `nature`, `reference`, `nrc`, `dateEffet`, PDF) | 11 entries |
| `/api/modeselection` | Selection-mode catalogue (AOON, AOOI, SFQC, ED, CDC…) | used to skip ED/CDC |

**Robots / terms.** `robots.txt` → HTTP 404 (RFC 9309: no restrictions). No terms-of-use page; footer
"Copyright © 2024 Portail National des Marchés Publics". The portal describes itself as "la plateforme officielle
pour la publication des informations et documents relatifs aux marchés publics en Mauritanie".

**Documents.** Notice PDFs are mostly **scanned images** (no text layer). Measured on real notices: Tesseract 5
`fra+ara` at 200 dpi reads them well; the submission deadline is a sentence such as « Les offres devront être
déposées au plus tard le Mardi 01/09/2026 à 12h 00 TU ». Tesseract must run with `OMP_THREAD_LIMIT=1`: with default
OpenMP threads, `fra+ara` took 93 s/page vs 2.6 s single-threaded on the same page.

**Data-quality notes.** Titles contain typos ("avis attibution defenitive"); plan amounts are usually 0 (unknown,
not zero); some notices are award or cancellation notices mixed into the same feed (classified by title).

**Decisions.** Polite rate limit 3 s; allow-list of fields (staff sub-objects never stored); direct agreements
(Entente directe, Consultation directe) skipped; undated notices older than 90 days presumed closed.
**Legal checkpoint (spec §108):** no explicit licence — FORSA shows metadata, extracted requirements and a link to
the official PDF with attribution. Before large-scale commercial redistribution, obtain written confirmation from
ARMP. **Recommend reporting the `/api/avisgenerale` personal-data exposure to ARMP.**

## 2. World Bank procurement notices (verified 2026-09-24)

* API: `GET https://search.worldbank.org/api/v2/procnotices?format=json&rows=&os=&project_ctry_name_exact=Mauritania
  &srt=noticedate&order=desc` — 1,899 Mauritania notices (of 420,173). `v3` path returns 404.
* Fields used: `id`, `notice_type`, `noticedate`, `notice_lang_name`, `notice_status`, `submission_deadline_date`,
  `submission_deadline_time`, `project_id`, `project_name`, `bid_reference_no`, `bid_description`,
  `procurement_group` (GO/CW/CS/NC), `procurement_method_code/name`, `contact_organization`, `notice_text` (HTML).
* Not stored: `contact_name`, `contact_email`, `contact_phone_no`, `contact_address` (personal data).
* Licence: dataset page (data catalog 0037795) — **Creative Commons Attribution 4.0**. Attribution shown in the UI.
* Notice mix (latest 100): 77 contract awards, 13 EOI, 8 IFB, 1 prequalification, 1 general notice.
* Awards: winners, signed price and rejected/evaluated firms parsed from `notice_text`; winners of
  individual-consultant contracts are recorded as "individual" without a name.
* Public notice page: `https://projects.worldbank.org/en/projects-operations/procurement-detail/{id}` (HTTP 200).

## 3. UNGM — United Nations Global Marketplace (verified 2026-09-24)

* Developer Center articles read: Ping, Get Notices, Get Notice by key, Search Notices, Notice CSDL, Authorization
  Code Grant, Refresh Access Token, Client Credentials Grant.
* `GET https://www.ungm.org/API/Ping` → "Pong - Production"; `GET /API/Notices` → 401 without token (as documented).
* `/API/Notices` requires a **user** access token (Authorization Code Grant). Client id/secret are issued by the
  UNGM Secretariat; roles via eprocurement@ungm.org. Refresh tokens are single-use (rotated, persisted 0600) and
  expire after 6 months unused.
* `robots.txt` allows `/Public/Notice`, but the registry forbids scraping: **API only**.
* Status: connector implemented and active; health **AUTH_REQUIRED** until `UNGM_CLIENT_ID`, `UNGM_CLIENT_SECRET`,
  `UNGM_REFRESH_TOKEN` are set. Enum values of `Type` other than `RequestForEoi`/`NotSet` are unverified.

## Verification procedure
1. Open the official site/API docs; save the terms and robots.txt (date + URL).
2. Record structure: listing URL + pagination, detail pages, document links, plans, awards, languages.
3. Capture real pages as parser fixtures, stripped of personal data (`backend/tests/fixtures/sources/`).
4. Record rate limits and polite interval; choose `update_frequency_hours`.
5. Legal checkpoint (spec §108): commercial reuse rights, attribution, personal data.
6. Only then set `status: active`.
