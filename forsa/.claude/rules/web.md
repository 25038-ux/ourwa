---
paths:
  - "web/**"
---
# Web rules
- All API calls go through `lib/api.ts` (same-origin, CSRF header). Never store tokens in localStorage.
- Show evidence and uncertainty: every score has a "Why?", unknowns are visible, synthetic data is badged.
- Product language: "FORSA estimates… based on the available evidence". No "you are eligible", no win odds.
- Mobile-first: check 390 px width (bottom tab bar, sheets, safe areas) and 1360 px. Colours via CSS tokens (light + dark).
- Motion is purposeful: springs from `lib/motion.ts` for things you touch, short eases for things that appear;
  animate state changes (layout, lists, counters), never block reading. Always respect reduced motion
  (`MotionConfig reducedMotion="user"` + the CSS media query). No motion that implies certainty FORSA lacks.
- Data fetching through `lib/store.ts` (`useApi`, `revalidate`) so live events refresh pages instantly.
- Consequential actions (decision, approval, submission) are explicit buttons, never automatic.
- Run `npx tsc --noEmit` and `npm run build`; screenshot changed pages at 390 px and 1360 px.
