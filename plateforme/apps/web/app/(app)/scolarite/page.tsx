/**
 * Le hub Scolarité, à son adresse — `pages/super_admin/scolarite.php`.
 *
 * ⚠ IL RENVOYAIT VERS `/scolarite/emploi`, ET L'ADRESSE COMPTE. Chez elle le hub
 * EST `scolarite.php` : les onglets sont des fragments, l'URL ne bouge pas, et
 * `?tab=emploi` n'est que l'onglet ouvert par défaut. Une redirection déplaçait
 * l'opérateur vers une autre adresse dès l'arrivée, et un signet posé sur
 * « Gestion de scolarité » ne revenait jamais là où il avait été posé.
 *
 * L'onglet par défaut est donc rendu ICI, tel quel. `/scolarite/emploi` continue
 * de répondre — c'est la même page, comme `scolarite.php?tab=emploi` l'est chez
 * elle.
 */
export { default, dynamic } from './emploi/page';
