/**
 * LE BULLETIN OFFICIEL, RENDU EN HTML — une seule fois, pour tout le monde.
 *
 * Le site du personnel (« Notes & Bulletins »), l'application des familles
 * (l'onglet Bulletin et son PDF) lisent le MÊME document : ce fichier le
 * produit, `bulletin-css.ts` l'habille. Le composant React du site ne fait
 * qu'insérer cette chaîne ; l'API la sert telle quelle à l'application, qui
 * l'affiche et en tire le PDF. Décision du propriétaire (2026-09-19) : le
 * bulletin du téléphone partage l'interface du bulletin du site — pas une
 * ressemblance, une identité.
 *
 * Porté de `includes/bulletin_vue.php` : en-tête tricolonne bilingue, bandeau
 * de titre, six lignes bilingues, le tableau avec sa ligne d'en-tête arabe
 * AU-DESSUS de la française, le pied tricolonne (résultats, signature,
 * observations) et la mise en garde. Rien ici ne calcule : les chiffres
 * arrivent tout faits (`@elourwa/shared/bulletin`), et un `-1` n'y entre
 * jamais — `absent` est un drapeau.
 */

export interface BulletinSubject {
  subject: string;
  coefficient: number;
  maxScore: string;
  courseworkMarks: string[];
  coursework: string | null;
  exam: string | null;
  mark: string | null;
  markOutOf20: string | null;
  absent: boolean;
  /** Moyenne × coefficient, calculé par le serveur en décimal. */
  total?: string | null;
}

export interface BulletinVerdict {
  status: 'admis' | 'ajourne' | 'non_evalue';
  label: string;
  labelAr: string;
  cssClass: string;
}

export interface BulletinCard {
  regime: 'classic' | 'fondamental';
  firstName: string;
  lastName: string;
  rim: string;
  matricule?: string | null;
  sex: string | null;
  groupName: string | null;
  levelName: string | null;
  guardianName: string | null;
  term: number;
  academicYear: string;
  subjects: BulletinSubject[];
  average: string | null;
  band: string | null;
  points: string | null;
  outOf: string | null;
  totalCoefficients?: number;
  formula?: { courseworkWeight: string; examWeight: string; divisor: string };
  passMark: string;
  termRecap: (string | null)[];
  termRecapFondamental: ({ points: string; outOf: string } | null)[];
  annualAverage: string | null;
  annualFondamental: { points: string; outOf: string } | null;
  verdict: BulletinVerdict;
  annualVerdict: BulletinVerdict | null;
  verdictHidden?: boolean;
}

/** Tout ce qui vient des données passe par ici : un nom d'élève n'est pas du balisage. */
export function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function coef(value: string | undefined, fallback: string): string {
  const n = Number(value ?? fallback);
  return String(Number.isFinite(n) ? Number(n.toFixed(2)) : fallback);
}

/** Son `date('l d F Y')` en français — la date du jour où l'on imprime. */
export function dateFr(d = new Date()): string {
  const jours = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
  const mois = ['', 'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
  return `${jours[d.getDay()]} ${String(d.getDate()).padStart(2, '0')} ${mois[d.getMonth() + 1]} ${d.getFullYear()}`;
}

function anneeScolaire(label: string): string {
  const m = /^(\d{4})-(\d{4})$/.exec(label);
  return m ? `${m[1]} – ${m[2]}` : label;
}

function classeSeuil(valeur: number | null, seuil: number): string {
  if (valeur === null) return '';
  return valeur >= seuil ? 'bul-pass' : 'bul-fail';
}

const ordinal = (t: number) => (t === 1 ? 'er' : 'e');

/** Sa pastille de décision — `badge_admission()`, trois paires de couleurs, deux langues. */
function badgeAdmission(verdict: BulletinVerdict): string {
  const couleurs: Record<string, [string, string]> = {
    admis: ['#065F46', '#D1FAE5'],
    ajourne: ['#991B1B', '#FEE2E2'],
    non_evalue: ['#4B5563', '#F3F4F6'],
  };
  const [texte, fond] = couleurs[verdict.status] ?? couleurs.non_evalue!;
  return `<span style="display:inline-block;padding:.12rem .5rem;border-radius:3px;font-weight:700;color:${texte};background:${fond}">${esc(verdict.label)} <span dir="rtl" lang="ar">${esc(verdict.labelAr)}</span></span>`;
}

const LOGO = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" width="52" height="52" style="color:#1a6b3c" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M4.26 10.147a60.436 60.436 0 00-.491 6.347A48.627 48.627 0 0112 20.904a48.627 48.627 0 018.232-4.41 60.46 60.46 0 00-.491-6.347m-15.482 0a50.57 50.57 0 00-2.658-.813A59.905 59.905 0 0112 3.493a59.902 59.902 0 0110.399 5.84c-.896.248-1.783.52-2.658.814m-15.482 0A50.697 50.697 0 0112 13.489a50.702 50.702 0 017.74-3.342"/></svg>`;

/**
 * Le document, de l'en-tête à la mise en garde. `date` permet un rendu
 * reproductible (tests) ; sans elle, la date du jour.
 */
export function renderBulletinOfficiel(card: BulletinCard, schoolName: string, opts: { date?: Date } = {}): string {
  const fond = card.regime === 'fondamental';
  const verdict = card.verdict;
  const verdictAnnee = card.annualVerdict;
  const seuil = Number(card.passMark);
  const verdictAffiche = card.verdictHidden !== true;

  // ⚠ UN NIVEAU FONDAMENTAL SE COMPARE EN ÉQUIVALENT /20. Il cumule des points
  // sur un barème ; opposer ces points bruts à un seuil sur 20 colorerait en
  // rouge absolument tous les trimestres.
  const equiv20 = (rf: { points: string; outOf: string }): number | null => {
    const sur = Number(rf.outOf);
    return sur > 0 ? (Number(rf.points) * 20) / sur : null;
  };

  const infos: [string, string, string][] = [
    ['السنة الدراسية', 'Année Scolaire', esc(anneeScolaire(card.academicYear))],
    ['الاسم', 'Nom et Prénom', `<strong>${esc(card.firstName)} ${esc(card.lastName)}</strong>`],
    ['رقم التسجيل', 'Matricule', esc(card.matricule ?? '')],
    ['القسم', 'Classe', `<strong>${esc(card.levelName ?? '')} — ${esc(card.groupName ?? '')}</strong>`],
    ['الفصل', 'Trimestre', `${card.term}<sup>${ordinal(card.term)}</sup>`],
    ['ولي الأمر', 'Parent / Tuteur', esc(card.guardianName ?? '')],
  ];

  const theadFond = `
    <tr class="bul-thead-ar" dir="rtl" lang="ar"><th>المواد</th><th>الفروض</th><th>متوسط الفروض</th><th>الامتحان</th><th>المعدل ÷2</th><th>السلّم</th></tr>
    <tr class="bul-thead-fr"><th>Matière</th><th>Devoirs</th><th>Moy. Devoirs</th><th>Examen</th><th>Moyenne (÷2)</th><th>Notée sur</th></tr>`;
  const cw = coef(card.formula?.courseworkWeight, '2');
  const ex = coef(card.formula?.examWeight, '3');
  const dv = coef(card.formula?.divisor, '5');
  const theadClassique = `
    <tr class="bul-thead-ar" dir="rtl" lang="ar"><th>المواد</th><th>الفروض</th><th>متوسط الفروض<br><small>× ${cw}</small></th><th>الامتحان<br><small>× ${ex}</small></th><th>المعدل<br><small>÷ ${dv}</small></th><th>المعامل</th><th>المجموع</th></tr>
    <tr class="bul-thead-fr"><th>Matière</th><th>Devoirs</th><th>Moy. Devoirs<br><small>× ${cw}</small></th><th>Examen<br><small>× ${ex}</small></th><th>Moyenne<br><small>÷ ${dv}</small></th><th>Coeff.</th><th>Total</th></tr>`;

  const lignes = card.subjects
    .map((s, i) => {
      const moy = s.mark !== null ? Number(s.mark) : null;
      const total = s.total ?? (moy !== null ? (moy * s.coefficient).toFixed(2) : null);
      const devoirs = s.courseworkMarks.length > 0 ? esc(s.courseworkMarks.join(' · ')) : '—';
      const styleDevoirs = fond ? 'font-size:.78rem' : 'font-size:.78rem;letter-spacing:.3px';
      const cellules = fond
        ? `<td style="font-weight:800;color:#1a6b3c">${s.absent ? 'Absent' : esc(s.mark ?? '—')}</td><td>/ ${Number(s.maxScore)}</td>`
        : `<td class="bul-td-moy ${moy === null ? '' : moy >= 10 ? 'bul-pass' : 'bul-fail'}">${s.absent ? 'Absent' : esc(s.mark ?? '—')}</td><td>${s.coefficient}</td><td class="bul-td-total">${total ?? '—'}</td>`;
      return `<tr class="${i % 2 === 0 ? 'bul-row-odd' : 'bul-row-even'}"><td class="bul-td-subject">${esc(s.subject)}</td><td style="${styleDevoirs}">${devoirs}</td><td>${esc(s.coursework ?? '—')}</td><td>${esc(s.exam ?? '—')}</td>${cellules}</tr>`;
    })
    .join('');

  const tfoot = fond
    ? `<td class="bul-tfoot-avg ${Number(card.outOf) > 0 && Number(card.points) / Number(card.outOf) >= 0.5 ? 'bul-pass' : 'bul-fail'}" colspan="2"><strong>${Number(card.outOf) > 0 ? `${esc(card.points)} / ${Number(card.outOf)}` : '—'}</strong></td>`
    : `<td>${card.totalCoefficients ?? card.subjects.filter((s) => s.mark !== null).reduce((n, s) => n + s.coefficient, 0)}</td><td class="bul-tfoot-avg ${verdictAffiche ? esc(verdict.cssClass) : ''}"><strong>${esc(card.average ?? 'N/A')}</strong></td>`;

  const recap = fond
    ? card.termRecapFondamental
        .map(
          (rf, i) =>
            `<div class="bul-result-row"><span class="bul-lbl-fr">Total — ${i + 1}<sup>${ordinal(i + 1)}</sup> trimestre :</span><strong class="${rf ? classeSeuil(equiv20(rf), seuil) : ''}">${rf ? `${esc(rf.points)} / ${Number(rf.outOf)}` : '—'}</strong></div>`,
        )
        .join('')
    : card.termRecap
        .map(
          (mg, i) =>
            `<div class="bul-result-row"><span class="bul-lbl-fr">Moyenne Générale — ${i + 1}<sup>${ordinal(i + 1)}</sup> trimestre :</span><strong class="${mg !== null ? classeSeuil(Number(mg), seuil) : ''}">${mg !== null ? `${esc(mg)} / 20` : '—'}</strong></div>`,
        )
        .join('');

  const annuel =
    card.annualAverage !== null || card.annualFondamental !== null
      ? `<div class="bul-result-row" style="border-top:1.5px solid #1a6b3c;margin-top:.35rem;padding-top:.35rem"><span class="bul-lbl-fr"><strong>Moyenne Générale de l&#39;Année :</strong> <span dir="rtl" lang="ar">المعدل السنوي</span></span><strong class="${esc(verdictAnnee?.cssClass ?? '')}" style="font-size:1.05rem">${card.annualFondamental ? `${esc(card.annualFondamental.points)} / ${Number(card.annualFondamental.outOf)}` : `${esc(card.annualAverage)} / 20`}</strong></div>`
      : '';

  // ⚠ LE BLOC S'AFFICHE MÊME SANS NOTES (« Non évalué ») ; seul le masquage
  // pour dette, côté famille, le retire — `verdictHidden`.
  const decision = verdictAffiche
    ? `<div class="bul-result-row" style="margin-top:.4rem"><span class="bul-lbl-fr">Appréciation (${card.term}<sup>${ordinal(card.term)}</sup> trim.) :</span><strong class="${esc(verdict.cssClass)}">${esc(card.band ?? '')}</strong></div>
       <div class="bul-result-row" style="margin-top:.4rem"><span class="bul-lbl-fr">${verdictAnnee ? 'Décision annuelle' : 'Résultat du trimestre'} : <span dir="rtl" lang="ar">${verdictAnnee ? 'القرار السنوي' : 'نتيجة الفصل'}</span></span>${badgeAdmission(verdictAnnee ?? verdict)}</div>
       <p style="margin-top:.35rem;font-size:.68rem;color:#666">Seuil d&#39;admission : ${esc(card.passMark.replace('.', ','))} / 20${verdictAnnee ? '' : ' — résultat provisoire, la décision se prend sur la moyenne annuelle'}</p>`
    : '';

  return `<div class="bulletin-off" id="bulletin">
  <div class="bul-header">
    <div class="bul-hcol bul-hcol-fr"><p class="bul-republic">République Islamique de Mauritanie</p><p class="bul-honor">Honneur – Fraternité – Justice</p><p class="bul-ministry">Ministère de l&#39;Éducation Nationale</p></div>
    <div class="bul-hcol bul-hcol-center"><div class="bul-logo-wrap">${LOGO}<span class="bul-logo-name">${esc(schoolName)}</span></div></div>
    <div class="bul-hcol bul-hcol-ar" dir="rtl" lang="ar"><p class="bul-republic">الجمهورية الإسلامية الموريتانية</p><p class="bul-honor">شرف – إخاء – عدل</p><p class="bul-ministry">وزارة التربية الوطنية</p></div>
  </div>
  <div class="bul-title-band"><span class="bul-title-ar" dir="rtl" lang="ar">بطاقة الأعداد</span><span class="bul-title-sep">—</span><span class="bul-title-fr">BULLETIN DE NOTES</span><span class="bul-title-sep">—</span><span class="bul-title-ar" dir="rtl" lang="ar">بطاقة الأعداد</span></div>
  <div class="bul-info-grid">
    ${infos.map(([ar, fr, valeur]) => `<div class="bul-info-row"><span class="bul-lbl-ar" dir="rtl" lang="ar">${ar}</span><span class="bul-sep">|</span><span class="bul-lbl-fr">${fr}</span><span class="bul-val">${valeur}</span></div>`).join('')}
  </div>
  <table class="bul-table">
    <thead>${fond ? theadFond : theadClassique}</thead>
    <tbody>${lignes}</tbody>
    <tfoot><tr class="bul-tfoot"><td colspan="${fond ? 4 : 5}" class="bul-tfoot-label"><span dir="rtl" lang="ar">${fond ? 'المجموع العام' : 'المعدل العام'}</span> | ${fond ? 'TOTAL GÉNÉRAL' : 'Moyenne Générale'}</td>${tfoot}</tr></tfoot>
  </table>
  <div class="bul-footer-grid">
    <div class="bul-foot-col">
      <p class="bul-foot-title">Résultats / النتائج</p>
      ${recap}
      ${annuel}
      ${decision}
      <p style="margin-top:.75rem;font-size:.72rem;color:#555">Le ${esc(dateFr(opts.date))}</p>
    </div>
    <div class="bul-foot-col bul-foot-center"><p class="bul-foot-title"><span dir="rtl" lang="ar">توقيع مدير المدرسة وختمها</span><br>Signature et cachet du Directeur</p><div class="bul-sig-area"></div></div>
    <div class="bul-foot-col" dir="rtl" lang="ar" style="text-align:right"><p class="bul-foot-title">ملاحظات المدير — Observations du Directeur</p><div class="bul-obs-area" style="min-height:70px"></div></div>
  </div>
  <div class="bul-warning">⚠ هذه الوثيقة لا تصلح بدون توقيع — CE DOCUMENT N&#39;EST PAS VALABLE SANS SIGNATURE ⚠</div>
</div>`;
}

/**
 * Le document complet, autonome — ce que l'API rend à l'application des
 * familles : la même feuille, en ligne, et une page qui tient sur un téléphone
 * comme sur une feuille A4 (le PDF en est tiré tel quel).
 */
export function renderBulletinDocument(card: BulletinCard, schoolName: string, css: string, opts: { date?: Date; lang?: 'fr' | 'ar' } = {}): string {
  const titre = `Bulletin — ${card.firstName} ${card.lastName} — T${card.term} ${card.academicYear}`;
  return `<!doctype html>
<html lang="${opts.lang ?? 'fr'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(titre)}</title>
<style>
html, body { margin: 0; padding: 0; background: #fff; }
body { padding: 8px; -webkit-text-size-adjust: 100%; }
.bulletin-off { margin: 0 auto; }
@media (max-width: 640px) { .bulletin-off { padding: .75rem .6rem; font-size: .72rem; } .bul-table th, .bul-table td { padding: .2rem .25rem; } }
@page { size: A4; margin: 10mm; }
${css}
</style>
</head>
<body>${renderBulletinOfficiel(card, schoolName, opts)}</body>
</html>`;
}
