import { PrintButton } from '@/components/print-button';
import { TarifForm } from './tarif-form';

export interface BillingGroup {
  levelName: string;
  groupName: string;
  students: number;
  amount: string;
}

export interface BillingBranch {
  id: string;
  slug: string;
  name: string;
  currency: string;
  students: number;
  monthly: string;
  annual: string;
  groups: BillingGroup[];
}

export interface Billing {
  tariff: string;
  branches: BillingBranch[];
  totals: { students: number; monthly: string; annual: string };
}

/** Its `number_format($x, 0, ',', ' ')`. */
function mru(v: string | number): string {
  return String(Math.round(Number(v))).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/**
 * LE TARIF GARDE SES CENTIMES QUAND IL EN A : « 500 », mais « 750,55 ».
 *
 * ⚠ L'ARRONDI D'AFFICHAGE FAISAIT MENTIR LA LIGNE DE CONTRÔLE. Le tarif était
 * une constante entière chez El Ourwa, donc `number_format($x, 0)` ne pouvait
 * rien trahir. Le nôtre se règle à la centime près, et « 600 × 751 » à côté d'un
 * total de 450 330 est une soustraction que personne ne peut refaire : 600 × 751
 * fait 450 600. C'est précisément le désaccord que le tableau par classe existe
 * pour éviter.
 *
 * Découpé sur la CHAÎNE, jamais reconverti en `number` : un montant ne repasse
 * pas par un flottant, fût-ce pour être affiché (règle 6).
 */
function tarif(v: string): string {
  const [entier = '0', decimales = ''] = String(v).split('.');
  const mille = entier.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const centimes = decimales.padEnd(2, '0').slice(0, 2);
  return centimes === '00' ? mille : `${mille},${centimes}`;
}

/**
 * FACTURATION — `sidibrahim.php`'s reason for existing.
 *
 * ⚠ ITS CONSOLE IS A BILLING SCREEN AND OURS WAS NOT. It opens with "Suivi des
 * effectifs et facturation" and shows four tiles — enrolled pupils, the tariff,
 * this month's invoice, the annual projection — then a table of every class with
 * its own line and a TOTAL row.
 *
 * Ours showed collected revenue and expenses, which is a different question
 * entirely: what a branch COLLECTS is the school's business, what it OWES for
 * using the platform is `élèves × tarif`. Nothing here could answer the second.
 *
 * ⚠ THE PER-CLASS TABLE IS NOT DECORATION. It is how a disagreement about a
 * headcount gets settled: the school checks its own invoice class by class. A
 * single total invites an argument nobody can resolve.
 *
 * Printable, as its is — this is a document that gets sent.
 */
export function Facturation({ billing }: { billing: Billing }) {
  const currency = billing.branches[0]?.currency ?? 'MRU';

  return (
    <section className="table-container" style={{ marginBottom: '1.5rem' }}>
      <div className="table-header">
        <h3>Facturation</h3>
        <span className="badge badge-primary">
          {tarif(billing.tariff)} {currency} / élève
        </span>
        <PrintButton label="Imprimer" />
      </div>

      <div className="kpi-grid" style={{ padding: '1rem' }}>
        <div className="kpi-card">
          <p className="kpi-label">Élèves inscrits</p>
          <p className="kpi-value">{mru(billing.totals.students)}</p>
          <p className="kpi-detail">Toutes branches · année en cours</p>
        </div>
        <div className="kpi-card kpi-secondary">
          <p className="kpi-label">Tarif par élève</p>
          <p className="kpi-value">{tarif(billing.tariff)}</p>
          <p className="kpi-detail">{currency} / mois</p>
        </div>
        <div className="kpi-card kpi-success">
          <p className="kpi-label">Facturation mensuelle</p>
          <p className="kpi-value">{mru(billing.totals.monthly)}</p>
          <p className="kpi-detail">
            {currency} — {mru(billing.totals.students)} × {tarif(billing.tariff)}
          </p>
        </div>
        <div className="kpi-card kpi-warning">
          <p className="kpi-label">Projection annuelle</p>
          <p className="kpi-value">{mru(billing.totals.annual)}</p>
          <p className="kpi-detail">{currency} (× 12 mois)</p>
        </div>
      </div>

      <TarifForm tariff={billing.tariff} currency={currency} />

      {/* ⚠ Its four columns, per branch: Niveau · Classe · Élèves · Montant. */}
      {billing.branches.map((b) => (
        <div key={b.id} style={{ padding: '0 1rem 1rem' }}>
          <h4 style={{ margin: '.6rem 0' }}>
            {b.name}{' '}
            <span className="text-muted" style={{ fontWeight: 400, fontSize: '.85rem' }}>
              — {mru(b.students)} élève(s) · {mru(b.monthly)} {b.currency}/mois
            </span>
          </h4>

          {b.groups.length === 0 ? (
            <p className="text-muted" style={{ fontSize: '.85rem' }}>
              Aucun élève inscrit pour l’année en cours — rien à facturer.
            </p>
          ) : (
            <div className="overflow-x">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Niveau</th>
                    <th>Classe</th>
                    <th style={{ textAlign: 'right' }}>Élèves</th>
                    <th style={{ textAlign: 'right' }}>Montant</th>
                  </tr>
                </thead>
                <tbody>
                  {b.groups.map((g) => (
                    <tr key={`${g.levelName}-${g.groupName}`}>
                      <td>{g.levelName}</td>
                      <td>{g.groupName}</td>
                      <td style={{ textAlign: 'right' }}>{mru(g.students)}</td>
                      <td style={{ textAlign: 'right' }}>
                        {mru(g.amount)} {b.currency}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{ fontWeight: 800 }}>
                    <td colSpan={2}>TOTAL</td>
                    <td style={{ textAlign: 'right' }}>{mru(b.students)}</td>
                    <td style={{ textAlign: 'right' }}>
                      {mru(b.monthly)} {b.currency}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      ))}
    </section>
  );
}
