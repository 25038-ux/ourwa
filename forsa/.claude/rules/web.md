---
paths:
  - "web/**"
---
# Web rules
- All API calls go through `lib/api.ts` (same-origin, CSRF header). Never store tokens in localStorage.
- Show evidence and uncertainty: every score has a "Why?", unknowns are visible, synthetic data is badged.
- Product language: "FORSA estimates… based on the available evidence". No "you are eligible", no win odds.
- Mobile-first: check 390 px width. No decorative gradients or AI animations. Colours via CSS tokens.
- Consequential actions (decision, approval, submission) are explicit buttons, never automatic.
- Run `npx tsc --noEmit` and `npm run build`.
