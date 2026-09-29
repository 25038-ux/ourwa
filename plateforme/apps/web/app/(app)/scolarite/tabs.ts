import type { HubTab } from '@/components/hub';

/**
 * The Scolarité hub's tabs — `pages/super_admin/scolarite.php`.
 *
 * Its keys, its order, its labels. "Exclusions" carries a ⚠ in its own tab
 * markup, which is kept: it is the one tab that refuses somebody entry, and the
 * mark is how a person scanning the row knows which it is.
 */
export const SCOLARITE_TABS: (HubTab & { ico?: string })[] = [
  { key: 'emploi', label: 'Emploi du temps', href: '/scolarite' },
  { key: 'absence', label: "Gérer l'absence", href: '/scolarite/absence' },
  { key: 'groupes', label: 'Groupes', href: '/scolarite/groupes' },
  { key: 'niveaux', label: 'Niveaux', href: '/scolarite/niveaux' },
  { key: 'expelled', label: 'Exclusions', href: '/scolarite/exclusions', ico: '⚠' },
  { key: 'notes', label: 'Notes & bulletins', href: '/scolarite/notes' },
];
