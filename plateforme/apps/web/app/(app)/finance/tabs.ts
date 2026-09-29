import type { HubTab } from '@/components/hub';

/**
 * The Finance hub's tabs — `pages/super_admin/finance.php`.
 *
 * Its keys, its order and its labels, including the capitalisation it uses:
 * "Gestion de Caisse" and "Rapport Mensuel" carry capitals mid-phrase, "Revenue
 * Live" is English in a French interface. Those are the words the office reads.
 */
export const FINANCE_TABS: HubTab[] = [
  { key: 'caisse', label: 'Gestion de Caisse', href: '/finance' },
  { key: 'revenue', label: 'Revenue Live', href: '/finance/revenue' },
  { key: 'rapport', label: 'Rapport Mensuel', href: '/finance/rapport' },
  { key: 'staff', label: 'Paiement du personnel', href: '/finance/staff' },
  { key: 'dette', label: 'Dettes', href: '/finance/dettes' },
  { key: 'depenses', label: 'Dépenses', href: '/finance/depenses' },
  { key: 'impayes', label: 'Impayés', href: '/finance/impayes' },
  // El Ourwa: the Administrateurs tab is added only when the viewer is not the
  // accountant. A withdrawal ceiling is the direction's business.
  { key: 'admins', label: 'Administrateurs', href: '/finance/administrateurs', hideFromAccountant: true },
];

/**
 * Le comptable voit tous les onglets sauf « Administrateurs ».
 *
 * ⚠ SA CONDITION EST `est_comptable()`, RIEN DE PLUS — c'est-à-dire
 * `a_role('comptable')`. Nous ajoutions « et pas super_admin », ce qui rendait
 * l'onglet à un agent cumulant les deux rôles ; chez lui le cumul ne lève pas
 * la règle. Un plafond de retrait est l'affaire de la direction, et quelqu'un
 * qui tient aussi la caisse reste quelqu'un qui tient la caisse.
 */
export function financeTabsFor(roles: string[]): HubTab[] {
  const comptable = roles.includes('comptable');
  return FINANCE_TABS.filter((t) => !(t.hideFromAccountant && comptable));
}
