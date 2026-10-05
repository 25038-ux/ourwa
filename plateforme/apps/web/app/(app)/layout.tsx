import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { apiInjoignable, readSession } from '@/lib/session';
import { ServeurInjoignable } from '@/components/serveur-injoignable';
import { currentSchool } from '@/lib/tenant';
import { Sidebar } from '@/components/sidebar';
import { FormValidation } from '@/components/form-validation';
import { TiroirNavigation } from '@/components/tiroir-navigation';
import { TableauxEnCartes } from '@/components/tableaux-cartes';
import { DEPLOIEMENT, MARQUE, hoteAvecSlug } from '@/lib/brand';
import { LOGO_MARQUE } from '@/lib/brand-logo';

/**
 * The authenticated shell — El Ourwa's `includes/layout_header.php`.
 *
 * `app-layout` wrapping `sidebar` + `main-content` is its structure, and the
 * classes come from its own stylesheet rather than from anything invented here.
 *
 * The sidebar is permission-aware, but hiding a link is NOT authorisation —
 * every page behind these carries its own server-side guard. This only spares
 * people from being offered doors that answer 403, which is El Ourwa's own
 * comment on the same filter.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await readSession();
  // ⚠ L'API NE RÉPOND PAS ≠ SESSION EXPIRÉE (05/10/2026). La coquille
  // renvoyait à la connexion avec « Votre session a expirée » au moindre
  // redémarrage de l'API — cookies intacts, page perdue. Elle reste sur place
  // et revient d'elle-même.
  if (!session && apiInjoignable()) {
    return (
      <main className="main-content" id="main-content" style={{ maxWidth: '48rem', margin: '2rem auto', padding: '0 1rem' }}>
        <ServeurInjoignable />
      </main>
    );
  }
  if (!session) redirect('/login?erreur=session_expiree');
  const { user } = session;

  // The active link is decided from the path, as El Ourwa decides it from
  // `$_SERVER['SCRIPT_NAME']`.
  const entetes = await headers();
  const current = entetes.get('x-pathname') ?? '/';

  /**
   * ⚠ "VOUS DEVEZ CHANGER VOTRE MOT DE PASSE AVANT DE CONTINUER."
   *
   * El Ourwa stops you at the door: an account still on its issued password
   * lands on the password screen and no other page opens. Ours stored the flag,
   * returned it at login, and acted on it nowhere — so a temporary password
   * written on a slip at the counter stayed valid indefinitely.
   *
   * The profile page is the one exception, because that is where the password
   * is changed. Everything else redirects there.
   */
  if (user.mustChangePassword && current !== '/profile') {
    redirect('/profile?motdepasse=obligatoire');
  }
  const school = await currentSchool();

  // L'administrateur de la plateforme, hors de toute école : sa console.
  // Une installation sans console n'a pas de « console » à dessiner.
  const plateforme = DEPLOIEMENT.console && !school && !!user.isPlatformAdmin && !user.schoolId;
  const roleLabel = plateforme ? 'Administrateur de la plateforme' :
    {
      super_admin: 'Super administrateur',
      admin: 'Administrateur',
      comptable: 'Comptable',
      secretaire: 'Secrétaire',
      collecteur_absence: "Collecteur d'absence",
      professeur: 'Professeur',
      parent: 'Parent',
    }[user.roles[0] ?? ''] ?? 'Sans rôle';

  return (
    <>
      {/* ⚠ Ses règles de validation, qui n'avaient jamais été portées — alors
          que `.input-error` et `.field-error` sont dans notre feuille de style
          depuis le premier jour, copiée au caractère près de la sienne. Rien ne
          les posait : chaque formulaire retombait sur la bulle native. */}
      <FormValidation />

      <a href="#main-content" className="skip-link">
        Aller au contenu
      </a>
      <div className="app-layout">
        <Sidebar
          roles={user.roles}
          permissions={user.permissions}
          plateforme={plateforme}
          current={current}
          schoolName={school?.name ?? MARQUE.nom}
          userName={user.fullName}
          userRole={roleLabel}
          billingModel={school?.billingModel ?? 'famille'}
          logo={LOGO_MARQUE}
        />
        <div className="sidebar-backdrop" id="sidebar-backdrop" hidden />
        {/* Le bouton du menu sous 1024 px — sans lui, la barre latérale disparaissait sur téléphone. */}
        <TiroirNavigation />
        {/* Sous 640 px, les tableaux de liste deviennent des cartes (responsive.css). */}
        <TableauxEnCartes />

        <main className="main-content" id="main-content">
          {/*
            Without this banner somebody eventually acts in the wrong school
            believing they are elsewhere. It is not decoration.
          */}
          {user.impersonated && (
            <div className="alert alert-warning" style={{ margin: '0 0 1rem' }}>
              Vous êtes dans <strong>{school?.name ?? 'cette branche'}</strong> en tant
              qu&apos;administrateur plateforme. Session limitée à 30 minutes, journalisée.{' '}
              {/* ⚠ Visait `admin.localhost:3000` en dur — inutilisable en ligne.
                  Le même hôte, première étiquette « admin ». */}
              <a href={`${entetes.get('x-forwarded-proto') ?? 'http'}://${hoteAvecSlug(entetes.get('x-forwarded-host') ?? entetes.get('host') ?? 'localhost:3000', null)}/platform`}>Quitter</a>
            </div>
          )}
          {children}
        </main>
      </div>
    </>
  );
}
