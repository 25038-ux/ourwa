import { describe, expect, it } from 'vitest';
import { renderBulletinDocument, renderBulletinOfficiel, type BulletinCard } from './bulletin-html.js';
import { BULLETIN_CSS } from './bulletin-css.js';

const carte: BulletinCard = {
  regime: 'classic',
  firstName: 'Aïcha <b>',
  lastName: "M'Bareck & Cie",
  rim: 'RIM-1',
  matricule: '0042',
  sex: 'F',
  groupName: '6ème A',
  levelName: 'Sixième',
  guardianName: 'Fatimetou',
  term: 1,
  academicYear: '2025-2026',
  subjects: [
    { subject: 'Mathématiques', coefficient: 3, maxScore: '20', courseworkMarks: ['12', '14'], coursework: '13', exam: '10', mark: '11.2', markOutOf20: '11.2', absent: false },
    { subject: 'Arabe', coefficient: 2, maxScore: '20', courseworkMarks: [], coursework: null, exam: null, mark: null, markOutOf20: null, absent: true },
  ],
  average: '11.20',
  band: 'Passable',
  points: null,
  outOf: null,
  totalCoefficients: 3,
  formula: { courseworkWeight: '2', examWeight: '3', divisor: '5' },
  passMark: '10.00',
  termRecap: ['11.20', null, null],
  termRecapFondamental: [],
  annualAverage: null,
  annualFondamental: null,
  verdict: { status: 'admis', label: 'Admis', labelAr: 'ناجح', cssClass: 'bul-pass' },
  annualVerdict: null,
};

describe('le bulletin officiel rendu en HTML — le même document pour le site et l’application', () => {
  const html = renderBulletinOfficiel(carte, 'École Nour', { date: new Date(2026, 8, 19) });

  it('échappe ce qui vient des données', () => {
    expect(html).toContain('Aïcha &lt;b&gt;');
    expect(html).toContain('M&#39;Bareck &amp; Cie');
    expect(html).not.toContain('<b>');
  });

  it('⚠ la ligne d’en-tête arabe précède la française, et les coefficients sont imprimés', () => {
    expect(html.indexOf('bul-thead-ar')).toBeLessThan(html.indexOf('bul-thead-fr'));
    expect(html).toContain('× 2');
    expect(html).toContain('× 3');
    expect(html).toContain('÷ 5');
  });

  it('une absence est dite, jamais rendue comme une note', () => {
    expect(html).toContain('<td class="bul-td-moy ">Absent</td>');
    expect(html).not.toMatch(/>-1(\.0+)?</);
  });

  it('porte la décision, le seuil, la date et la mise en garde', () => {
    expect(html).toContain('Admis');
    expect(html).toContain('Seuil d&#39;admission : 10,00 / 20');
    expect(html).toContain('Samedi 19 Septembre 2026');
    expect(html).toContain('PAS VALABLE SANS');
  });

  it('retenu pour dette : ni appréciation ni décision', () => {
    const retenu = renderBulletinOfficiel({ ...carte, verdictHidden: true, average: null, band: null }, 'École Nour');
    expect(retenu).not.toContain('Appréciation');
    expect(retenu).not.toContain('Résultat du trimestre');
  });

  it('le document autonome embarque la feuille partagée', () => {
    const doc = renderBulletinDocument(carte, 'École Nour', BULLETIN_CSS, { lang: 'fr' });
    expect(doc.startsWith('<!doctype html>')).toBe(true);
    expect(doc).toContain('.bulletin-off {');
    expect(doc).toContain('<title>Bulletin — Aïcha &lt;b&gt; M&#39;Bareck &amp; Cie — T1 2025-2026</title>');
  });
});
