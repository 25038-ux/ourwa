import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { DocumentDirection } from '@/components/document-direction';
import { MARQUE } from '@/lib/brand';
import { currentSchool } from '@/lib/tenant';

/**
 * LES PAGES LÉGALES — publiques, sans connexion, dans les deux langues.
 *
 * Les deux magasins exigent une URL où la politique de confidentialité se lit
 * sans compte ; c'est celle-ci. Elle vit HORS du groupe `(app)`, dont la mise
 * en page renvoie à la connexion, et le texte vient de `content/legal/`, à
 * côté de l'application qui le sert — pas de `docs/`, qu'un déploiement ne
 * transporte pas forcément.
 *
 * ⚠ LE RENDU MARKDOWN EST VOLONTAIREMENT MINUSCULE. Titres, paragraphes,
 * listes, tableaux, gras, liens, citations : ce que ces deux documents
 * utilisent, et rien d'autre. Le texte est échappé AVANT toute transformation,
 * donc rien de ce qu'il contient ne devient du HTML — et c'est le seul endroit
 * de l'application où du HTML est composé à la main.
 */

const DOCS: Record<string, { fr: string; ar: string; titre: Record<'fr' | 'ar', string> }> = {
  confidentialite: {
    fr: 'confidentialite.fr.md',
    ar: 'confidentialite.ar.md',
    titre: { fr: 'Politique de confidentialité', ar: 'سياسة الخصوصية' },
  },
  conditions: {
    fr: 'conditions.fr.md',
    ar: 'conditions.ar.md',
    titre: { fr: 'Conditions d’utilisation', ar: 'شروط الاستخدام' },
  },
  // La page que le Play Store affiche sous « Suppression du compte » : lisible
  // sans compte ni application, comme l'exige sa règle de suppression.
  suppression: {
    fr: 'suppression.fr.md',
    ar: 'suppression.ar.md',
    titre: { fr: 'Supprimer votre compte', ar: 'حذف حسابكم' },
  },
};

/**
 * LES MENTIONS DE L'ÉCOLE — lues dans l'environnement À CHAQUE AFFICHAGE
 * (deploy/elmourad/.env → docker-compose.yml → ici), jamais écrites dans le
 * texte : le même document sert toute école, et l'école corrige une adresse ou
 * un téléphone sans reconstruire (`docker compose up -d web`).
 *
 * ⚠ AUCUN « [À COMPLÉTER] » NE DOIT PLUS ÊTRE PUBLIÉ. Une politique dont le
 * contact est un trou est refusée par le Play Store. Une mention vide fait donc
 * disparaître la LIGNE qui la porte (« Téléphone : » sans numéro ne s'affiche
 * pas) ; le nom de l'école et l'adresse retombent sur l'enseigne et Nouakchott.
 */
function mentions(lang: 'fr' | 'ar', services: boolean): Record<string, string> {
  const e = process.env;
  const v = (...xs: (string | undefined)[]) => xs.map((x) => (x ?? '').trim()).find(Boolean) ?? '';
  const ar = lang === 'ar';
  return {
    /*
     * La ligne « horaire d'étude et services souscrits » du § 3.3 (données
     * financières) : une école qui facture par élève et par service (Jinan,
     * ADR-0073) les enregistre ; une école « famille » n'en a pas — le jeton
     * vide fait disparaître la ligne, et sa politique reste mot pour mot celle
     * d'avant.
     */
    facturation_services: !services
      ? ''
      : ar
        ? 'مواقيت الدراسة (8h – 14h أو 8h – 17h) والخدمات الاختيارية المشترك فيها (المطعم المدرسي، المسبح، الطبيب، النسخ)'
        : "Horaire d'étude (8h – 14h ou 8h – 17h) et services optionnels souscrits (cantine, piscine, docteur, photocopie)",
    marque: MARQUE.nom,
    marque_ar: MARQUE.nomAr,
    ecole: ar
      ? v(e.LEGAL_ENTITY_AR, e.LEGAL_ENTITY, MARQUE.nomAr)
      : v(e.LEGAL_ENTITY, MARQUE.nom),
    adresse: ar
      ? v(e.LEGAL_ADDRESS_AR, e.LEGAL_ADDRESS, 'نواكشوط، موريتانيا')
      : v(e.LEGAL_ADDRESS, 'Nouakchott, Mauritanie'),
    courriel: v(e.LEGAL_EMAIL),
    telephone: v(e.LEGAL_PHONE),
    hebergeur: ar ? v(e.LEGAL_HOST_AR, e.LEGAL_HOST) : v(e.LEGAL_HOST),
    domaine: v(e.PUBLIC_DOMAIN),
    date: v(e.LEGAL_UPDATED),
  };
}

/** Remplit les jetons `{{nom}}` ; une ligne dont un jeton est vide est retirée. */
function remplir(md: string, m: Record<string, string>): string {
  return md
    .split('\n')
    .filter((ligne) => [...ligne.matchAll(/\{\{(\w+)\}\}/g)].every((j) => (m[j[1]!] ?? '') !== ''))
    .map((ligne) => ligne.replace(/\{\{(\w+)\}\}/g, (_t, nom: string) => m[nom] ?? ''))
    .join('\n');
}

function echapper(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function enLigne(s: string): string {
  return s
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, texte: string, href: string) =>
      /^(\/|https?:\/\/)/.test(href) ? `<a href="${href}">${texte}</a>` : texte,
    );
}

/** Markdown → HTML, pour le sous-ensemble que les deux documents emploient. */
function rendre(md: string): string {
  const lignes = echapper(md).split('\n');
  const out: string[] = [];
  let liste: string[] = [];
  let tableau: string[][] = [];
  let citation: string[] = [];
  let paragraphe: string[] = [];

  const vider = () => {
    if (paragraphe.length) {
      out.push(`<p>${enLigne(paragraphe.join(' '))}</p>`);
      paragraphe = [];
    }
    if (liste.length) {
      out.push(`<ul>${liste.map((l) => `<li>${enLigne(l)}</li>`).join('')}</ul>`);
      liste = [];
    }
    if (citation.length) {
      out.push(`<blockquote>${enLigne(citation.join(' '))}</blockquote>`);
      citation = [];
    }
    if (tableau.length) {
      const [tete, ...corps] = tableau;
      out.push(
        `<div class="table-wrap"><table><thead><tr>${tete!.map((c) => `<th>${enLigne(c)}</th>`).join('')}</tr></thead>` +
          `<tbody>${corps.map((r) => `<tr>${r.map((c) => `<td>${enLigne(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`,
      );
      tableau = [];
    }
  };

  for (const brute of lignes) {
    const l = brute.trimEnd();
    const titre = /^(#{1,3}) (.*)$/.exec(l);
    if (titre) {
      vider();
      const n = titre[1]!.length;
      out.push(`<h${n}>${enLigne(titre[2]!)}</h${n}>`);
      continue;
    }
    if (l === '---') {
      vider();
      out.push('<hr />');
      continue;
    }
    if (l.startsWith('|')) {
      const cellules = l.split('|').slice(1, -1).map((c) => c.trim());
      if (cellules.every((c) => /^-+$/.test(c))) continue; // la ligne de séparation
      if (paragraphe.length || liste.length) vider();
      tableau.push(cellules);
      continue;
    }
    if (l.startsWith('&gt; ') || l === '&gt;') {
      if (paragraphe.length || liste.length || tableau.length) vider();
      citation.push(l.replace(/^&gt; ?/, ''));
      continue;
    }
    if (/^- /.test(l)) {
      if (paragraphe.length || tableau.length || citation.length) vider();
      liste.push(l.slice(2));
      continue;
    }
    if (l === '') {
      vider();
      continue;
    }
    // Une ligne de suite d'un élément de liste (indentée) ou d'une citation.
    if (liste.length && /^\s{2,}/.test(brute)) {
      liste[liste.length - 1] += ' ' + l.trim();
      continue;
    }
    if (citation.length) {
      citation.push(l);
      continue;
    }
    if (tableau.length) vider();
    paragraphe.push(l);
  }
  vider();
  return out.join('\n');
}

async function lire(doc: string, lang: 'fr' | 'ar'): Promise<string | null> {
  const d = DOCS[doc];
  if (!d) return null;
  try {
    // Le texte nomme l'application et l'école par des jetons ({{marque}},
    // {{ecole}}, {{courriel}}…), remplis ici : le même document sert toute école.
    const texte = await readFile(join(process.cwd(), 'content', 'legal', d[lang]), 'utf8');
    // L'école de ce nom d'hôte, sans connexion (`GET /school` est public) ;
    // pas d'école ou API muette : « famille », la politique d'avant.
    const services = (await currentSchool())?.billingModel === 'services';
    return remplir(texte.replace(/\r\n/g, '\n'), mentions(lang, services));
  } catch {
    return null;
  }
}

type Props = { params: Promise<{ doc: string }>; searchParams: Promise<{ lang?: string }> };

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { doc } = await params;
  const lang = (await searchParams).lang === 'ar' ? 'ar' : 'fr';
  return { title: DOCS[doc]?.titre[lang] ?? MARQUE.nom, robots: { index: true } };
}

export default async function PageLegale({ params, searchParams }: Props) {
  const { doc } = await params;
  const lang = (await searchParams).lang === 'ar' ? 'ar' : 'fr';
  const md = await lire(doc, lang);
  if (!md) notFound();

  const autre = lang === 'fr' ? 'ar' : 'fr';
  return (
    <main
      dir={lang === 'ar' ? 'rtl' : 'ltr'}
      lang={lang}
      style={{
        maxWidth: '46rem',
        margin: '0 auto',
        padding: '2rem 1.25rem 4rem',
        fontFamily: 'Figtree, system-ui, sans-serif',
        lineHeight: 1.6,
      }}
    >
      <DocumentDirection lang={lang} dir={lang === 'ar' ? 'rtl' : 'ltr'} />
      <nav style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', marginBottom: '1.5rem' }}>
        <a href={`/legal/${doc === 'confidentialite' ? 'conditions' : 'confidentialite'}?lang=${lang}`}>
          {doc === 'confidentialite' ? DOCS.conditions!.titre[lang] : DOCS.confidentialite!.titre[lang]}
        </a>
        <a href={`/legal/${doc}?lang=${autre}`}>{autre === 'ar' ? 'العربية' : 'Français'}</a>
      </nav>
      <style>{`
        main h1 { font-size: 1.75rem; margin: 0 0 .5rem; }
        main h2 { font-size: 1.25rem; margin: 2rem 0 .5rem; }
        main h3 { font-size: 1.05rem; margin: 1.5rem 0 .25rem; }
        main blockquote { border-inline-start: 4px solid #b45309; background: #fff7ed; padding: .75rem 1rem; margin: 1rem 0; }
        main .table-wrap { overflow-x: auto; }
        main table { border-collapse: collapse; width: 100%; margin: .75rem 0; font-size: .95rem; }
        main th, main td { border: 1px solid #ddd; padding: .4rem .6rem; text-align: start; vertical-align: top; }
        main th { background: #f5f5f4; }
        main code { background: #f5f5f4; padding: 0 .25rem; border-radius: 3px; font-size: .9em; }
        main hr { border: 0; border-top: 1px solid #ddd; margin: 2rem 0; }
      `}</style>
      <article dangerouslySetInnerHTML={{ __html: rendre(md) }} />
    </main>
  );
}
