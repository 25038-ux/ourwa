import { ICONS } from './elourwa-icons';

/**
 * El Ourwa's sidebar, item for item.
 *
 * ⚠ THE TITLES, THE ORDER AND THE ROLE SETS ARE COPIED, NOT REDESIGNED.
 * `includes/sidebar.php` is the source. "Gestion de scolarité", "Demandes
 * comptable", "Ajouter Staff" — including its capitalisation — are what the
 * school's staff have been reading for years, and a better label is a worse
 * label if it means somebody has to look for the thing they used to know.
 */

export interface MenuItem {
  titre: string;
  href: string;
  icon: string;
  /** Hidden from a restricted admin, as El Ourwa's `finance` flag does. */
  finance?: boolean;
  /** Additionally gated on a permission, as its `perm` key does. */
  perm?: string;
  /**
   * Seulement dans une école qui facture par élève et par service (Jinan,
   * ADR-0073). Sans équivalent chez El Ourwa : une école « famille » ne voit
   * jamais l'entrée, son menu reste le sien, entrée pour entrée.
   */
  services?: boolean;
}

const SUPER_ADMIN: MenuItem[] = [
  { titre: 'Tableau de bord', href: '/', icon: ICONS.ICN_HOME! },
  { titre: 'Créer un utilisateur', href: '/comptes/creer', icon: ICONS.ICN_USER_ADD! },
  { titre: 'Inscrire un étudiant', href: '/students/new', icon: ICONS.ICN_STUDENT! },
  { titre: 'Réinscrire un étudiant', href: '/re-enrol', icon: ICONS.ICN_REIN! },
  { titre: 'Gestion de scolarité', href: '/scolarite', icon: ICONS.ICN_CAP! },
  { titre: 'Cours du soir', href: '/evening', icon: ICONS.ICN_CAL! },
  { titre: 'Saisir les notes', href: '/notes', icon: ICONS.ICN_NOTES! },
  { titre: 'Finance', href: '/finance', icon: ICONS.ICN_CASH!, finance: true },
  { titre: 'Administrateurs', href: '/finance/administrateurs', icon: ICONS.ICN_KEY!, finance: true },
  // La page « Frais » (spécification §9) : tarifs par mode, frais d'inscription,
  // prix des services. Direction seule — ce menu n'est que celui de super_admin
  // et d'admin — et écoles « services » seulement.
  { titre: 'Frais', href: '/frais', icon: ICONS.ICN_EXPENSE!, services: true },
  { titre: 'Années scolaires', href: '/annees', icon: ICONS.ICN_KEY! },
  { titre: 'Envoyer un exercice', href: '/homework', icon: ICONS.ICN_MSG! },
  { titre: 'Demandes comptable', href: '/requests', icon: ICONS.ICN_MSG! },
  { titre: 'Dérogations examens', href: '/derogations', icon: ICONS.ICN_CAL! },
  { titre: 'Historique', href: '/journal', icon: ICONS.ICN_SEARCH! },
  { titre: 'Messagerie parents', href: '/messages', icon: ICONS.ICN_MSG! },
  { titre: 'Gérer les professeurs', href: '/comptes/professeurs', icon: ICONS.ICN_CAP! },
  { titre: 'Ajouter Staff', href: '/comptes/staff', icon: ICONS.ICN_STAFF! },
  { titre: 'Statistiques', href: '/statistiques', icon: ICONS.ICN_LEVELS! },
  { titre: "Gérer l'absence", href: '/scolarite/absence', icon: ICONS.ICN_CHECK! },
  { titre: 'Recherche', href: '/search', icon: ICONS.ICN_SEARCH! },
  { titre: 'Mon profil', href: '/profile', icon: ICONS.ICN_PROFILE! },
  { titre: 'Comptes des parents', href: '/comptes/parents', icon: ICONS.ICN_KEY! },
  {
    titre: 'Comptes du personnel',
    href: '/comptes',
    icon: ICONS.ICN_STAFF!,
    perm: 'comptes.staff',
  },
];

const MENUS: Record<string, MenuItem[]> = {
  super_admin: SUPER_ADMIN,
  // El Ourwa: `$menus['admin'] = $menus['super_admin'];` — the same menu, with
  // the `finance` entries filtered out for a restricted administrator.
  admin: SUPER_ADMIN,
  professeur: [
    { titre: 'Tableau de bord', href: '/prof', icon: ICONS.ICN_HOME! },
    { titre: 'Saisir les notes', href: '/prof/notes', icon: ICONS.ICN_NOTES! },
    { titre: 'Envoyer un exercice', href: '/prof/exercice', icon: ICONS.ICN_MSG! },
    { titre: 'Remarques élèves', href: '/prof/remarques', icon: ICONS.ICN_MSG! },
    { titre: 'Mes classes', href: '/prof/classes', icon: ICONS.ICN_CAP! },
    { titre: 'Mon emploi du temps', href: '/prof/emploi', icon: ICONS.ICN_CAL! },
  ],
  collecteur_absence: [
    { titre: "Gérer l'absence", href: '/scolarite/absence', icon: ICONS.ICN_CHECK! },
  ],
  secretaire: [
    { titre: 'Inscrire un étudiant', href: '/students/new', icon: ICONS.ICN_STUDENT! },
    { titre: 'Réinscrire un étudiant', href: '/re-enrol', icon: ICONS.ICN_REIN! },
    { titre: 'Gestion de scolarité', href: '/scolarite', icon: ICONS.ICN_CAP! },
    { titre: 'Saisir les notes', href: '/notes', icon: ICONS.ICN_NOTES! },
  ],
  comptable: [
    { titre: 'Inscrire un étudiant', href: '/students/new', icon: ICONS.ICN_STUDENT! },
    { titre: 'Réinscrire un étudiant', href: '/re-enrol', icon: ICONS.ICN_REIN! },
    { titre: 'Finance', href: '/finance', icon: ICONS.ICN_CASH! },
    { titre: 'Demandes comptable', href: '/requests', icon: ICONS.ICN_MSG! },
  ],
};

/**
 * The menu for everything this person is.
 *
 * ⚠ MERGED ACROSS ROLES, not chosen from the main one. El Ourwa records why:
 * an accountant who is also a secretary saw only the accountant's menu, though
 * they held both sets of rights. Deduplicated on the link, keeping the order of
 * the widest role.
 */
export function menuFor(
  roles: string[],
  permissions: string[],
  billingModel: 'famille' | 'services' = 'famille',
): MenuItem[] {
  const order = [
    'super_admin',
    'admin',
    'comptable',
    'secretaire',
    'collecteur_absence',
    'professeur',
  ];

  const seen = new Set<string>();
  const menu: MenuItem[] = [];

  for (const role of order) {
    if (!roles.includes(role)) continue;
    for (const item of MENUS[role] ?? []) {
      if (seen.has(item.href)) continue;
      seen.add(item.href);
      menu.push(item);
    }
  }

  // A restricted administrator is one without the finance permissions —
  // El Ourwa's `est_admin_complet()`.
  const fullAdmin =
    roles.includes('super_admin') || permissions.includes('finance.consulter');

  return menu.filter((item) => {
    if (item.services && billingModel !== 'services') return false;
    if (item.finance && !fullAdmin) return false;
    // Hiding an entry authorises nothing: the page checks for itself. This only
    // avoids offering a link that would answer 403 — El Ourwa's own comment.
    if (item.perm && !permissions.includes(item.perm)) return false;
    return true;
  });
}

/** La console de la plateforme (`admin.<domaine>`) : deux entrées, pas de rôle d'école. */
const MENU_PLATEFORME: MenuItem[] = [
  { titre: 'Console de la plateforme', href: '/platform', icon: ICONS.ICN_KEY! },
  { titre: 'Mon profil', href: '/profile', icon: ICONS.ICN_PROFILE! },
];

export function Sidebar({
  roles,
  permissions,
  plateforme = false,
  current,
  schoolName,
  userName,
  userRole,
  billingModel = 'famille',
  logo = null,
}: {
  roles: string[];
  permissions: string[];
  plateforme?: boolean;
  current: string;
  schoolName: string;
  userName: string;
  userRole: string;
  /** `School.billingModel` — l'entrée « Frais » n'existe que pour `'services'`. */
  billingModel?: 'famille' | 'services';
  /**
   * Le logo de l'enseigne (`LOGO_MARQUE`, lib/brand-logo.ts) — `null` : le
   * chapeau d'El Ourwa, exactement comme avant (El Ourwa, El Mourad).
   */
  logo?: string | null;
}) {
  const items = plateforme ? MENU_PLATEFORME : menuFor(roles, permissions, billingModel);

  return (
    <aside className="sidebar" id="sidebar">
      <div className="sidebar-header">
        <div className="sidebar-logo">
          {logo ? (
            <img src={logo} alt="" width={32} height={32} style={{ borderRadius: 7, flexShrink: 0 }} />
          ) : (
            <svg
              aria-hidden="true"
              focusable="false"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
              width="32"
              height="32"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M4.26 10.147a60.436 60.436 0 00-.491 6.347A48.627 48.627 0 0112 20.904a48.627 48.627 0 018.232-4.41 60.46 60.46 0 00-.491-6.347m-15.482 0a50.57 50.57 0 00-2.658-.813A59.905 59.905 0 0112 3.493a59.902 59.902 0 0110.399 5.84c-.896.248-1.783.52-2.658.814m-15.482 0A50.697 50.697 0 0112 13.489a50.702 50.702 0 017.74-3.342"
              />
            </svg>
          )}
          <span>{schoolName}</span>
        </div>
      </div>

      <nav className="sidebar-nav">
        {items.map((item) => {
          const path = item.href.split('?')[0]!;
          const active = path === '/' ? current === '/' : current.startsWith(path);
          return (
            <a
              key={item.href}
              href={item.href}
              className={`sidebar-link${active ? ' active' : ''}`}
            >
              <span
                className="sidebar-icon"
                dangerouslySetInnerHTML={{ __html: item.icon }}
              />
              <span>{item.titre}</span>
            </a>
          );
        })}
      </nav>

      <div className="sidebar-footer">
        <div className="sidebar-user">
          <div className="sidebar-avatar">{userName.charAt(0).toUpperCase()}</div>
          <div className="sidebar-user-info">
            <div className="sidebar-user-name">{userName}</div>
            <div className="sidebar-user-role">{userRole}</div>
          </div>
        </div>
        <form action="/api/logout" method="post">
          <button type="submit" className="sidebar-link sidebar-logout">
            <span className="sidebar-icon">
              <svg
                aria-hidden="true"
                focusable="false"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l-3 3m0 0l3 3m-3-3h12.75"
                />
              </svg>
            </span>
            <span>Déconnexion</span>
          </button>
        </form>
      </div>
    </aside>
  );
}
