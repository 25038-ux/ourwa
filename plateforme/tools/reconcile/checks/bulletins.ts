import { readFileSync } from 'node:fs';
import Decimal from 'decimal.js';
import {
  classicReportCard,
  evaluateSubject,
  formula,
  type SubjectMarks,
} from '@elourwa/shared';
import type { Check, CheckResult } from '../types.js';

/**
 * LES BULLETINS, RÉCONCILIÉS SUR LES VRAIES NOTES.
 *
 * ⚠ EL OURWA CALCULE SES PROPRES CHIFFRES. `tools/reconcile/extraire.php` appelle
 * SON `bulletin_donnees()`, sur SA base, et écrit une ligne JSON par (élève,
 * trimestre) : les notes en entrée ET la moyenne qu'il en tire. Transcrire son
 * arithmétique ici reviendrait à tester ma transcription — c'est bien lui qui
 * produit le côté « legacy ».
 *
 * Nous rejouons EXACTEMENT les mêmes entrées à travers `@elourwa/shared`, et nous
 * comparons **en chaînes** (règle 25). Sur 3 000 bulletins et 139 000 notes
 * réelles, c'est la seule preuve qui vaille que le successeur rend les mêmes
 * nombres que le système qu'il remplace.
 *
 * ⚠ CE QUI N'EST PAS COUVERT ICI : la moyenne annuelle, le rang, et les régimes
 * fondamentaux — ils ont leurs propres vérifications. Cette passe couvre la
 * moyenne d'une matière et la moyenne générale d'un trimestre, qui sont ce
 * qu'une famille lit.
 */

interface LigneMatiere {
  matiere: string;
  coef: string;
  note_sur: string;
  devoirs: string[];
  examen: string | null;
  moyenne: string | null;
}

interface LigneBulletin {
  eleve: number;
  trimestre: number;
  fondamental: boolean;
  formule: { d: string; e: string; q: string };
  matieres: LigneMatiere[];
  moyenne_generale: string | null;
}

/** Son `number_format($x, 2, '.', '')` — deux décimales, point décimal. */
function deuxDecimales(v: Decimal | null): string | null {
  return v === null ? null : v.toFixed(2);
}

export function bulletinsCheck(fichier: string): Check {
  return {
    name: 'bulletins',
    group: 'bulletins',
    async run(): Promise<CheckResult[]> {
      const lignes = readFileSync(fichier, 'utf8')
        .split('\n')
        // ⚠ PHP ÉCRIT SES AVIS SUR LA SORTIE STANDARD. Un `Deprecated:` de
        // `config.php` s'était glissé dans l'extrait et cassait le premier
        // `JSON.parse`. On ne garde que les lignes qui sont un objet JSON.
        .filter((l) => l.trimStart().startsWith('{'))
        .map((l) => JSON.parse(l) as LigneBulletin);

      let matieresComparees = 0;
      let matieresAttendues = 0;
      let matieresInexpliquees = 0;
      let generalesComparees = 0;
      let generalesAttendues = 0;
      let generalesInexpliquees = 0;
      const echantillon: unknown[] = [];

      /**
       * ⚠ UNE DIVERGENCE ATTENDUE N'EST PAS UNE DIVERGENCE.
       *
       * El Ourwa moyenne le marqueur d'absence comme s'il valait −1 (ADR-0054).
       * Sur les niveaux en `examen_seul` — d=0, e=1, q=1 — la moyenne de la
       * matière devient donc « −1.00 », et la moyenne générale du trimestre avec
       * elle. La règle 11 dit que le marqueur doit être exclu AVANT toute
       * moyenne ; nous l'excluons, et nous divergeons exprès.
       *
       * Les compter à part est ce qui rend cette réconciliation utilisable comme
       * barrière : elle doit échouer sur l'inconnu, pas crier au loup sur le
       * connu. Une divergence SANS marqueur serait un vrai défaut.
       */
      const porteUnMarqueur = (m: LigneMatiere): boolean =>
        (m.examen !== null && new Decimal(m.examen).equals(-1)) ||
        m.devoirs.some((v) => new Decimal(v).equals(-1));

      for (const b of lignes) {
        // Les régimes fondamentaux ne passent pas par `classicReportCard`.
        if (b.fondamental) continue;

        const f = formula(b.formule.d, b.formule.e, b.formule.q);

        const marks: SubjectMarks[] = b.matieres.map((m, i) => ({
          subjectId: String(i),
          subjectName: m.matiere,
          maxScore: m.note_sur,
          coefficient: Number(m.coef),
          coursework: m.devoirs,
          exam: m.examen,
        }));

        // ── Matière par matière ────────────────────────────────────────────
        for (let i = 0; i < marks.length; i += 1) {
          const attendu = b.matieres[i]!.moyenne;
          const obtenu = deuxDecimales(evaluateSubject(marks[i]!, f).mark);
          matieresComparees += 1;
          if (attendu !== obtenu) {
            if (porteUnMarqueur(b.matieres[i]!)) {
              matieresAttendues += 1;
              continue;
            }
            matieresInexpliquees += 1;
            if (echantillon.length < 10) {
              echantillon.push({
                eleve: b.eleve,
                trimestre: b.trimestre,
                matiere: b.matieres[i]!.matiere,
                devoirs: b.matieres[i]!.devoirs,
                examen: b.matieres[i]!.examen,
                formule: b.formule,
                elourwa: attendu,
                nous: obtenu,
              });
            }
          }
        }

        // ── La moyenne générale du trimestre ───────────────────────────────
        const attenduG = b.moyenne_generale;
        const obtenuG = deuxDecimales(classicReportCard(marks, f).average);
        generalesComparees += 1;
        if (attenduG !== obtenuG) {
          if (b.matieres.some(porteUnMarqueur)) {
            generalesAttendues += 1;
            continue;
          }
          generalesInexpliquees += 1;
          if (echantillon.length < 10) {
            echantillon.push({
              eleve: b.eleve,
              trimestre: b.trimestre,
              generale: true,
              elourwa: attenduG,
              nous: obtenuG,
            });
          }
        }
      }

      return [
        {
          name: 'moyenne de matière',
          legacy: String(matieresComparees),
          current: String(matieresComparees - matieresInexpliquees),
          match: matieresInexpliquees === 0,
          delta:
            matieresInexpliquees > 0
              ? `${matieresInexpliquees} inexpliquées`
              : matieresAttendues > 0
                ? `${matieresAttendues} écarts attendus (marqueur d'absence, ADR-0054)`
                : undefined,
          sample: echantillon.length ? echantillon : undefined,
        },
        {
          name: 'moyenne générale du trimestre',
          legacy: String(generalesComparees),
          current: String(generalesComparees - generalesInexpliquees),
          match: generalesInexpliquees === 0,
          delta:
            generalesInexpliquees > 0
              ? `${generalesInexpliquees} inexpliquées`
              : generalesAttendues > 0
                ? `${generalesAttendues} écarts attendus (marqueur d'absence, ADR-0054)`
                : undefined,
        },
      ];
    },
  };
}
