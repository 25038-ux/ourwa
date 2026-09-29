import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { NOTIF, rendre, renduPourPousser } from './notifications.js';

/**
 * ⚠ DEUX COPIES DES MÊMES PHRASES, DANS DEUX LANGAGES. L'application parent rend
 * une notification en Dart ; le serveur la rend en TypeScript pour la pousser
 * sur un écran verrouillé. Le jour où l'une change sans l'autre, un parent lit
 * une phrase sur son téléphone et une autre dans l'application — pour le même
 * événement. Ce test lit la table Dart et exige que chaque clé `notif_*` y soit
 * identique, dans les deux langues.
 */

function tableDart(): Record<string, { fr: string; ar: string }> {
  const chemin = fileURLToPath(new URL('../../../apps/mobile/lib/src/i18n.dart', import.meta.url));
  const source = readFileSync(chemin, 'utf8').replace(/\/\/[^\n]*/g, '');
  const litteral = /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/;
  const out: Record<string, { fr: string; ar: string }> = {};
  for (const m of source.matchAll(/'(notif_[a-z_]+)'\s*:\s*\{([\s\S]*?)\},/g)) {
    const corps = m[2]!;
    const fr = new RegExp(`'fr'\\s*:\\s*${litteral.source}`).exec(corps)?.[1];
    const ar = new RegExp(`'ar'\\s*:\\s*${litteral.source}`).exec(corps)?.[1];
    if (!fr || !ar) continue;
    const lit = (s: string) => s.slice(1, -1).replace(/\\'/g, "'").replace(/\\"/g, '"');
    out[m[1]!] = { fr: lit(fr), ar: lit(ar) };
  }
  return out;
}

describe('les gabarits sont ceux de l’application, clé par clé', () => {
  const dart = tableDart();

  it('lit bien la table Dart', () => {
    expect(Object.keys(dart).length).toBeGreaterThanOrEqual(20);
  });

  it('⚠ chaque clé de l’application existe ici, avec les mêmes phrases', () => {
    for (const [cle, { fr, ar }] of Object.entries(dart)) {
      expect(NOTIF[cle], cle).toBeDefined();
      expect(NOTIF[cle]!.fr, `${cle}.fr`).toBe(fr);
      expect(NOTIF[cle]!.ar, `${cle}.ar`).toBe(ar);
    }
  });

  it('⚠ et aucune clé ici n’est inconnue de l’application', () => {
    for (const cle of Object.keys(NOTIF)) expect(dart[cle], cle).toBeDefined();
  });
});

describe('rendre', () => {
  it('remplace les paramètres dans la langue demandée', () => {
    expect(rendre('notif_absence_corps', { eleve: 'Ahmed', date: '12/09/2026' }, 'fr')).toBe(
      'Ahmed a été marqué(e) absent(e) le 12/09/2026.',
    );
    expect(rendre('notif_absence_titre', {}, 'ar')).toBe('تسجيل غياب');
  });

  it('laisse un paramètre absent VISIBLE, pour que le trou se voie', () => {
    expect(rendre('notif_absence_corps', { eleve: 'Ahmed' }, 'fr')).toContain('{date}');
  });
});

describe('renduPourPousser', () => {
  it('⚠ ne met jamais la note sur l’écran verrouillé', () => {
    const p = renduPourPousser(
      'notif_note',
      { eleve: 'Ahmed', note: '4.5', matiere: 'Maths', trimestre: 'T1' },
      'fr',
    );
    expect(p.title).toBe('Nouvelle note : Maths');
    expect(p.body).not.toContain('4.5');
    expect(p.body).toContain('—');
  });

  it('laisse tout le reste tel quel', () => {
    const p = renduPourPousser('notif_exercice', { matiere: 'Maths', titre: 'p. 12', eleve: 'Ahmed', limite: '' }, 'ar');
    expect(p.title).toBe('تمرين جديد : Maths');
    expect(p.body).toContain('Ahmed');
  });
});
