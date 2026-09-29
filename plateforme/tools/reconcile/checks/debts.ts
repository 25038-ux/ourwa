import { readFileSync } from 'node:fs';
import Decimal from 'decimal.js';
import type { Check, CheckResult } from '../types.js';
import { condense, sou } from './commun.js';

/**
 * LA DETTE DE SCOLARITÉ, CALCULÉE PAR CHACUN, FAMILLE PAR FAMILLE.
 *
 * ⚠ C'EST LE CHIFFRE QUE L'ÉCOLE RÉCLAME. Tout ce qui précède vérifie que les
 * lignes sont là ; celui-ci vérifie que la RÈGLE qui les additionne rend la même
 * somme. La dette n'est stockée nulle part — elle se déduit de l'échéancier, des
 * encaissements, des exemptions et des remises — donc c'est bien un calcul
 * qu'on compare, comme pour les bulletins.
 *
 * Les deux côtés produisent chacun un fichier, par leur propre code :
 *
 *   - `extraire-dettes.php` appelle SON `obtenir_dette_parent_detaillee()`,
 *     pour chacun des 1 372 correspondants ;
 *   - `apps/api/src/finance/extraire-dettes.ts` appelle NOTRE
 *     `DebtService.detailAcrossYears()` — la fonction que lisent l'écran de
 *     caisse, la porte des examens et la réinscription, pas une requête écrite
 *     pour l'occasion.
 *
 * ⚠ LA PREMIÈRE PASSE A DIVERGÉ DE VINGT FOIS. 1 574 000.00 chez lui,
 * 34 038 500.00 chez nous — 611 mois impayés contre 11 844. Sa règle ne compte
 * que l'année scolarisée : les arriérés des années passées sont CONSTATÉS dans
 * `dettes_familles`, et les recompter depuis l'échéancier les ferait payer deux
 * fois. El Ourwa avait raison (règle 26) ; `DebtService` s'aligne (ADR-0057).
 *
 * ⚠ ELLE DÉPEND DU JOUR — « un mois à venir n'est pas dû ». Les deux extraits
 * doivent dater du même jour ; `pnpm reconcile` le vérifie.
 *
 * Clé par TÉLÉPHONE, seul identifiant commun ; le rapport n'en montre aucun.
 */

interface Ligne {
  telephone: string;
  total: string;
  avant_remise: string;
  remise: string;
  scolarite: string;
  diverses: string;
  mois: number;
}

function lire(fichier: string): Map<string, Ligne> {
  const out = new Map<string, Ligne>();
  for (const l of readFileSync(fichier, 'utf8').split('\n')) {
    if (!l.trimStart().startsWith('{')) continue;
    const d = JSON.parse(l) as Ligne;
    out.set(d.telephone, d);
  }
  return out;
}

export function debtsCheck(lui: string, nous: string): Check {
  return {
    name: 'dette',
    group: 'debts',
    async run(): Promise<CheckResult[]> {
      const a = lire(lui);
      const b = lire(nous);
      const resultats: CheckResult[] = [];

      const mesurer = (name: string, legacy: string, current: string, delta?: string) => {
        resultats.push({ name, legacy, current, match: legacy === current, delta });
      };

      mesurer('familles', String(a.size), String(b.size));

      const communes = [...a.keys()].filter((k) => b.has(k));
      mesurer('familles rapprochées', String(a.size), String(communes.length));

      // Les cinq sommes, sur toutes les familles.
      for (const champ of ['total', 'scolarite', 'diverses', 'avant_remise', 'remise'] as const) {
        const somme = (m: Map<string, Ligne>) =>
          [...m.values()].reduce((acc, l) => acc.plus(l[champ]), new Decimal(0));
        mesurer(
          {
            total: 'dette totale',
            scolarite: 'scolarité due',
            diverses: 'dettes constatées et frais annuels',
            avant_remise: 'avant remise',
            remise: 'remises',
          }[champ],
          sou(somme(a)),
          sou(somme(b)),
        );
      }

      mesurer(
        'mois impayés',
        String([...a.values()].reduce((n, l) => n + l.mois, 0)),
        String([...b.values()].reduce((n, l) => n + l.mois, 0)),
      );

      mesurer(
        'familles endettées',
        String([...a.values()].filter((l) => new Decimal(l.total).greaterThan(0)).length),
        String([...b.values()].filter((l) => new Decimal(l.total).greaterThan(0)).length),
      );

      // ⚠ FAMILLE PAR FAMILLE, condensé. Un total juste peut cacher deux
      // familles inversées ; l'empreinte les verrait, et le rapport ne doit
      // porter ni numéro ni montant individuel.
      const empreinte = (m: Map<string, Ligne>) =>
        [...m.entries()]
          .map(([k, l]) => `${k}=${l.total}`)
          .sort()
          .join('|');
      const ea = empreinte(a);
      const eb = empreinte(b);
      const divergentes = communes.filter((k) => a.get(k)!.total !== b.get(k)!.total);
      resultats.push({
        name: 'dette par famille',
        legacy: condense(ea),
        current: condense(eb),
        match: divergentes.length === 0,
        delta: divergentes.length
          ? `${divergentes.length} famille(s) divergente(s) — --verbose`
          : undefined,
        sample: divergentes.slice(0, 10).map((k) => ({
          famille: '***',
          elourwa: a.get(k),
          nous: b.get(k),
        })),
      });

      return resultats;
    },
  };
}
