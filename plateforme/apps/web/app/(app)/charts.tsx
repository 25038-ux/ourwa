'use client';

import { BarChart, DonutChart } from '@/components/charts';

interface Props {
  byLevel: { name: string; revenue: string }[];
  byGroup: { name: string; revenue: string; headcount: number }[];
  revenuBrut: number;
  chargesProfs: number;
  chargesStaff: number;
  depensesSup: number;
  gainNet: number;
}

/**
 * THE DASHBOARD'S FOUR CHARTS — `tableau_bord.php`, its `.charts-grid`.
 *
 * Its four, in its order, under its headings:
 *
 *   Revenu par niveau · Revenu par groupe · Répartition financière ·
 *   Effectifs par groupe
 *
 * ⚠ THEY ARE DRAWN ONLY FOR SOMEONE WHO MAY SEE FINANCE. El Ourwa wraps the
 * whole grid in `if ($peut_voir_finance)` and shows a "Bienvenue" panel instead.
 * The page above enforces that; this component assumes it.
 *
 * ⚠ "REVENU" IS THE MONTHLY BILL, NOT THE MONTH'S RECEIPTS. It sums
 * `frais_mensuel` — what the school charges if everyone pays. A reader who
 * takes these bars for collections would think the school far better paid than
 * it is; the debt screens are where money actually received is answered.
 *
 * The last chart repeats the group axis with a headcount instead of a sum,
 * deliberately: the same bars in a different order tell you which groups are
 * large and which are merely expensive.
 */
export function DashboardCharts({
  byLevel,
  byGroup,
  revenuBrut,
  chargesProfs,
  chargesStaff,
  depensesSup,
  gainNet,
}: Props) {
  return (
    <div className="charts-grid">
      <div className="chart-card">
        <h3>Revenu par niveau</h3>
        <BarChart
          label="Revenu (MRU)"
          labels={byLevel.map((l) => l.name)}
          data={byLevel.map((l) => Number(l.revenue))}
        />
      </div>

      <div className="chart-card">
        <h3>Revenu par groupe</h3>
        <BarChart
          label="Revenu (MRU)"
          labels={byGroup.map((g) => g.name)}
          data={byGroup.map((g) => Number(g.revenue))}
        />
      </div>

      <div className="chart-card">
        <h3>Répartition financière</h3>
        {/* Its own labels and its own note on this chart: "no admin salary,
            includes depenses". A net gain below zero is clamped to zero rather
            than drawn — a negative slice of a doughnut has no meaning, and
            Chart.js would draw it as if it were positive. */}
        <DonutChart
          labels={[
            'Revenu brut',
            'Salaires professeurs',
            'Salaires staff',
            'Dépenses suppl.',
            'Gain net',
          ]}
          data={[
            revenuBrut,
            chargesProfs,
            chargesStaff,
            depensesSup,
            Math.max(0, gainNet),
          ]}
        />
      </div>

      <div className="chart-card">
        <h3>Effectifs par groupe</h3>
        <BarChart
          label="Nombre d'étudiants"
          labels={byGroup.map((g) => g.name)}
          data={byGroup.map((g) => g.headcount)}
          colour="#aebf92"
          integers
        />
      </div>
    </div>
  );
}
