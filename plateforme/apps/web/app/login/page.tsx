import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { currentSchoolOrSlug } from '@/lib/tenant';
import { readSession } from '@/lib/session';
import { accueilParRole, COOKIE_IDENTIFIANT_SAISI } from '@/lib/accueil';
import { PasswordField, SubmitGuard } from '@/components/login-form';
import { MARQUE } from '@/lib/brand';
import { LOGO_MARQUE } from '@/lib/brand-logo';

export const dynamic = 'force-dynamic';

/** Son `<title>` et son `<meta name="robots">`. */
export const metadata: Metadata = {
  title: `Connexion — ${MARQUE.nom}`,
  robots: 'noindex, nofollow',
};

/**
 * Connexion — El Ourwa's `espace-direction.php`.
 *
 * Its markup: the animated blobs behind, the brand block above the card, the
 * "Bienvenue" header, iconed fields, the eye toggle, the arrow on the button,
 * the link across to the parents' space, and the "Connexion chiffrée &
 * sécurisée" badge underneath.
 *
 * Still a plain server-rendered form posting to a route handler (ADR-0011), so
 * it works before JavaScript loads — the right behaviour for the first screen of
 * an application used on slow connections. Only the eye needs the script.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; erreur?: string; deconnexion?: string }>;
}) {
  const params = await searchParams;

  // « Déjà connecté → tableau de bord ».
  const session = await readSession();
  if (session) redirect(accueilParRole(session.user.roles, session.user.isPlatformAdmin && !session.user.schoolId));

  // Ses trois messages : le refus de la tentative, `?erreur=session_expiree`,
  // `?deconnexion` — et l'identifiant saisi, rendu au champ après un refus.
  let erreur = params.error ?? '';
  if (params.erreur === 'session_expiree') erreur = 'Votre session a expiré. Veuillez vous reconnecter.';
  if (params.erreur === 'api_injoignable') erreur = 'Le serveur ne répond pas pour le moment. Réessayez dans un instant — votre session n’a pas été fermée.';
  if (params.erreur === 'origine') erreur = 'Le formulaire ne vient pas de ce site. Reprenez la connexion ici.';
  const info = params.deconnexion !== undefined ? 'Vous avez été déconnecté avec succès.' : '';
  const identifiantSaisi = (await cookies()).get(COOKIE_IDENTIFIANT_SAISI)?.value ?? '';

  const school = await currentSchoolOrSlug();
  const name = school?.name ?? MARQUE.nom;

  return (
    <div className="login-body">
      <div className="login-bg" aria-hidden="true">
        <div className="login-blob login-blob-1" />
        <div className="login-blob login-blob-2" />
        <div className="login-blob login-blob-3" />
      </div>

      <div className="login-page">
        <div className="login-container">
          <div className="login-brand">
            {LOGO_MARQUE ? (
              // Le logo de l'enseigne (Jinan) dans le cadre du chapeau, qu'il remplit.
              <div className="login-brand-logo" style={{ padding: 0, overflow: 'hidden', background: 'none' }}>
                <img src={LOGO_MARQUE} alt="" width={80} height={80} style={{ display: 'block', width: '100%', height: '100%' }} />
              </div>
            ) : (
              <div className="login-brand-logo">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1.8}
                  stroke="currentColor"
                  width="44"
                  height="44"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M4.26 10.147a60.436 60.436 0 00-.491 6.347A48.627 48.627 0 0112 20.904a48.627 48.627 0 018.232-4.41 60.46 60.46 0 00-.491-6.347m-15.482 0a50.57 50.57 0 00-2.658-.813A59.905 59.905 0 0112 3.493a59.902 59.902 0 0110.399 5.84c-.896.248-1.783.52-2.658.814m-15.482 0A50.697 50.697 0 0112 13.489a50.702 50.702 0 017.74-3.342M6.75 15a.75.75 0 100-1.5.75.75 0 000 1.5zm0 0v-3.675A55.378 55.378 0 0112 8.443m-7.007 11.55A5.981 5.981 0 006.75 15.75v-1.5"
                  />
                </svg>
              </div>
            )}
            {/* The branch's own name where El Ourwa prints "El Ourwa": one
                installation there, several here, and a person signing in needs
                to know which school they are signing in to. */}
            <h1>{name}</h1>
            <p>{MARQUE.sousTitre}</p>
          </div>

          <div className="login-card">
            <div className="login-card-header">
              <h2>Bienvenue</h2>
              <p>Connectez-vous pour accéder à votre espace</p>
            </div>

            {erreur && (
              <div className="alert alert-error">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={2}
                  stroke="currentColor"
                  width="18"
                  height="18"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
                  />
                </svg>
                <span>{erreur}</span>
              </div>
            )}

            {info && (
              <div className="alert alert-success">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={2}
                  stroke="currentColor"
                  width="18"
                  height="18"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                <span>{info}</span>
              </div>
            )}

            <form method="POST" action="/api/login" id="form-connexion" autoComplete="off" noValidate>
              <div className="form-group form-group-icon">
                <label htmlFor="identifiant">Identifiant</label>
                <div className="input-wrapper">
                  <svg
                    className="input-icon"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={1.5}
                    stroke="currentColor"
                    width="18"
                    height="18"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z"
                    />
                  </svg>
                  <input
                    type="text"
                    id="identifiant"
                    name="identifier"
                    defaultValue={identifiantSaisi}
                    placeholder="ex. enseignant@supnum.mr"
                    required
                    autoFocus
                    autoComplete="username"
                    maxLength={100}
                  />
                </div>
              </div>

              <PasswordField />

              <button type="submit" className="btn btn-primary btn-login" id="btn-connexion">
                <span>Se connecter</span>
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={2}
                  stroke="currentColor"
                  width="18"
                  height="18"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3"
                  />
                </svg>
              </button>
              <SubmitGuard />
            </form>

            {/**
              * ⚠ PAS DE « MOT DE PASSE OUBLIÉ », ET C'EST UNE DÉCISION.
              *
              * Un libre-service a existé ici. Le propriétaire l'a retiré
              * (2026-09-04) : seul un SUPER administrateur réinitialise un mot
              * de passe, depuis « Comptes du personnel » ou « Comptes des
              * parents ». El Ourwa n'en a pas non plus — son
              * `reinitialiser_mdp.php` est une page d'administration.
              *
              * Le lien reste absent volontairement : une page de connexion qui
              * propose une sortie que personne ne peut emprunter est pire que
              * pas de sortie du tout.
              */}

            {/**
              * ⚠ NO PARENT SPACE ON THE WEB, AND THE LINK IS GONE.
              *
              * This pointed at `/parent`, a route that never existed — a dead
              * link on the front door since the day it was written. El Ourwa
              * serves families from the same host because it is one PHP
              * application; here the family's space IS the Flutter app, and
              * offering a web door to it promises something that is not there.
              *
              * The direction signs in here. Families sign in on their phone.
              */}

            {/*
              ⚠ SON BADGE MANQUAIT — le dernier écart connu de sa page de
              connexion, noté dans l'audit et jamais comblé. C'est la seule
              chose que sa porte d'entrée dit et que la nôtre taisait : une
              famille ou un agent qui hésite à taper son mot de passe sur un
              poste partagé lit d'abord cette ligne.

              Son icône et ses mots, tels quels.
            */}
            <div className="login-secure-badge">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
                width="14"
                height="14"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751A11.959 11.959 0 0112 2.714z"
                />
              </svg>
              Connexion chiffrée &amp; sécurisée
            </div>
          </div>

          <p className="login-footer">
            © {new Date().getFullYear()} {MARQUE.nom} — Tous droits réservés
          </p>
        </div>
      </div>
    </div>
  );
}
