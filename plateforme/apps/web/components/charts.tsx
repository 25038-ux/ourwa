'use client';

import { useEffect, useRef } from 'react';
import {
  Chart,
  BarController,
  BarElement,
  DoughnutController,
  ArcElement,
  CategoryScale,
  LinearScale,
  Legend,
  Tooltip,
  type ChartConfiguration,
} from 'chart.js';

/**
 * EL OURWA'S CHARTS — `tableau_bord.php`, its `$scripts_supplementaires`.
 *
 * ⚠ SELF-HOSTED, NOT FROM A CDN. El Ourwa loads Chart.js from jsdelivr; the CSP
 * here does not allow another origin to serve script, because a script-src that
 * permits a CDN permits anything that CDN ever serves. Same library, same
 * version family, bundled with the app.
 *
 * ⚠ ITS PALETTE, NOT CHART.JS'S. Its own comment says why it was changed once
 * already: "L'ancienne palette (indigo, ambre, émeraude…) jurait avec le reste
 * de l'écran." These eight are the Organic ramp — terracotta, olive, and the
 * warm steps between — and they are the values from that file.
 *
 * Only the four controllers actually used are registered. Chart.js registers
 * everything by default, which pulls line, radar, polar and bubble into a bundle
 * that renders bars and one doughnut.
 */
Chart.register(
  BarController,
  BarElement,
  DoughnutController,
  ArcElement,
  CategoryScale,
  LinearScale,
  Legend,
  Tooltip,
);

/** Its `colors`, in its order. */
export const ORGANIC = [
  '#c67139',
  '#7a8a5e',
  '#b2622d',
  '#8fa073',
  '#8c491a',
  '#56633f',
  '#f6a06b',
  '#aebf92',
];

/** Its `Chart.defaults` block. */
function applyDefaults() {
  Chart.defaults.font.family = 'Figtree, system-ui, sans-serif';
  Chart.defaults.color = '#645c50';
  Chart.defaults.borderColor = 'rgba(32,30,29,.10)';
}

function useChart<T extends 'bar' | 'doughnut'>(config: ChartConfiguration<T>) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    applyDefaults();
    const chart = new Chart(ref.current, config as ChartConfiguration);
    return () => chart.destroy();
    // The config is rebuilt from props on every render; comparing it by identity
    // would tear down and rebuild the chart on each one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(config.data), config.type]);

  return ref;
}

/**
 * A bar chart in its shape: rounded caps, no legend, zero-based axis.
 *
 * `borderRadius: 8, borderSkipped: false` is what rounds BOTH ends rather than
 * only the top — that is its setting, and it is what makes these bars look like
 * its bars rather than default Chart.js ones.
 */
export function BarChart({
  labels,
  data,
  label,
  colour,
  integers = false,
}: {
  labels: string[];
  data: number[];
  label: string;
  /** One colour for the whole series, or the palette sliced per bar. */
  colour?: string;
  /** `stepSize: 1` — a headcount axis must not offer half a pupil. */
  integers?: boolean;
}) {
  const ref = useChart<'bar'>({
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label,
          data,
          backgroundColor: colour ?? ORGANIC.slice(0, Math.max(1, labels.length)),
          borderRadius: 8,
          borderSkipped: false,
        },
      ],
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        y: {
          beginAtZero: true,
          ...(integers ? { ticks: { stepSize: 1 } } : {}),
        },
      },
    },
  });

  return <canvas ref={ref} role="img" aria-label={label} />;
}

/**
 * RÉPARTITION FINANCIÈRE — the doughnut.
 *
 * ⚠ ITS FIVE COLOURS ARE FIXED AND MEANINGFUL, not taken from the palette in
 * order: revenue terracotta, teachers' pay amber, staff pay olive, expenses the
 * red used for debt everywhere else, and net gain the olive used for "en règle".
 * A reader who has learnt that red means money owed reads this the same way.
 *
 * Its own comment on this chart: "no admin salary, includes depenses".
 */
export function DonutChart({
  labels,
  data,
}: {
  labels: string[];
  data: number[];
}) {
  const ref = useChart<'doughnut'>({
    type: 'doughnut',
    data: {
      labels,
      datasets: [
        {
          data,
          backgroundColor: ['#c67139', '#c98a12', '#7a8a5e', '#a8341f', '#728157'],
          borderWidth: 0,
          hoverOffset: 8,
        },
      ],
    },
    options: {
      responsive: true,
      cutout: '60%',
      plugins: { legend: { position: 'bottom' } },
    },
  });

  return <canvas ref={ref} role="img" aria-label="Répartition financière" />;
}
