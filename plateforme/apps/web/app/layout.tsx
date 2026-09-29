import type { Metadata } from 'next';
import './globals.css';
import { headers } from 'next/headers';
import { currentSchool } from '@/lib/tenant';
import { MARQUE } from '@/lib/brand';

export async function generateMetadata(): Promise<Metadata> {
  const school = await currentSchool();
  return {
    title: school ? `${school.name} — ${MARQUE.nom}` : MARQUE.nom,
    description: `${MARQUE.nom} — ${MARQUE.sousTitre}`,
  };
}

/** `/elourwa/<nom>.css?v=<construction>` — voir VERSION_FEUILLES dans next.config.mjs. */
const feuille = (nom: string) => `/elourwa/${nom}.css?v=${process.env.VERSION_FEUILLES ?? ''}`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const school = await currentSchool();

  /**
   * ⚠ THE NONCE THAT REPLACED `'unsafe-inline'`.
   *
   * Middleware mints one per request and puts it both in the CSP and in this
   * header. Reading it here is what lets Next stamp its own inline bootstrap —
   * without it the app is served under a policy its own scripts violate, and
   * the page renders blank.
   *
   * An injected `<script>` has no nonce and does not execute, which is the
   * whole point: `'unsafe-inline'` meant any injected script ran, so the CSP
   * was not defending against the attack it exists for.
   */
  const nonce = (await headers()).get('x-nonce') ?? undefined;

  return (
    <html
      lang={school?.locale ?? 'fr'}
      dir={school?.locale === 'ar' ? 'rtl' : 'ltr'}
      // La marque, lisible des composants client (lib/brand-client.ts).
      data-marque={MARQUE.nom}
      data-marque-ar={MARQUE.nomAr}
    >
      <head>
        {/*
          El Ourwa's own faces, loaded the way it loads them: Caprasimo for
          headings, Figtree for the body, four weights rather than ten, and
          `display=swap` so text appears immediately in the fallback.
        */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Caprasimo&family=Figtree:wght@400;600;700&display=swap"
          rel="stylesheet"
        />
        {/*
          ⚠ EL OURWA'S ACTUAL STYLESHEETS, not an approximation of them.

          The whole 1 600-line sheet consumes a token layer at the top, so this
          is also the seam where a branch's own colour could be applied later
          without touching a single page.
        */}
        <link rel="stylesheet" href={feuille('style')} />
        <link rel="stylesheet" href={feuille('bulletin-officiel')} />
        <link rel="stylesheet" href={feuille('bulletin')} />
        {/* The receipt is a document a family keeps — its own stylesheet, its
            own print rules. Copied from `recu_styles()`. */}
        <link rel="stylesheet" href={feuille('recu')} />
        {/*
          ⚠ NEUF DE SES PAGES PORTENT LEUR PROPRE `<style>`, et aucune n'était
          dans `style.css`. Notre copie de `style.css` est identique au caractère
          près, ce qui avait fait croire que la question des styles était réglée —
          elle l'était pour vingt-six pages sur trente-cinq.

          C'est l'explication de « le CSS de la page n'est pas le même » : il ne
          l'était pas, parce qu'il n'avait jamais été copié.
        */}
        <link rel="stylesheet" href={feuille('pages')} />
        {/*
          The pages not yet rewritten, wearing El Ourwa's clothes.

          A half-converted product is not "half right" — it is two products, and
          a page still on my own design system reads as a different application
          to the person using it. compat.css defines every class name I invented
          in El Ourwa's own tokens, so an unconverted page looks right while its
          markup is rewritten in its turn.

          ⚠ IT IS MEANT TO BE DELETED. Loaded last so it wins; the file itself
          says which blocks go when.
        */}
        <link rel="stylesheet" href={feuille('compat')} />
        {/* ⚠ EN DERNIER : l'adaptation aux téléphones et aux iPad (24/09/2026).
            Les feuilles d'El Ourwa restent intactes ; tout ce qui les ajuste
            aux petits écrans vit dans responsive.css, qui l'emporte. */}
        <link rel="stylesheet" href={feuille('responsive')} />
      </head>
      <body>{children}</body>
    </html>
  );
}
