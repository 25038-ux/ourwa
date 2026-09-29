import type { HubTab } from '@/components/hub';

/**
 * The Cours du soir hub's tabs — `pages/super_admin/cours_du_soir.php`.
 *
 * Two, and its capitalisation: "Groupes de Cours du Soir" carries capitals
 * mid-phrase, "Paiement des Professeurs" does too. Those are the words the
 * office reads on that bar.
 */
export const EVENING_TABS: HubTab[] = [
  { key: 'groupes', label: 'Groupes de Cours du Soir', href: '/evening' },
  { key: 'profs', label: 'Paiement des Professeurs', href: '/evening/professeurs' },
];
