import { apiFetch, requireSession } from '@/lib/session';
import { PageHeader } from '@/components/page-header';
import { MessagePage } from '@/components/message-page';
import { PASSWORD_MIN_LENGTH } from '@elourwa/shared/password';
import { NameForm } from './name-form';
import { PasswordForm } from './password-form';
import { IdentifiantForm } from './identifiant-form';

export const dynamic = 'force-dynamic';

/**
 * Le libellé du rôle : « Super Administrateur » (la constante de sa carte) et,
 * pour les autres comptes qui atteignent cette page chez nous, les libellés de
 * son `charger_nom_complet()`.
 */
const ROLES: Record<string, string> = {
  super_admin: 'Super Administrateur',
  admin: 'Administrateur',
  comptable: 'Comptable',
  secretaire: 'Secrétaire',
  collecteur_absence: "Collecteur d'absence",
  professeur: 'Professeur',
};

/**
 * MON PROFIL — `pages/super_admin/modifier_profil.php` : « Identité
 * actuelle », « Modifier mon nom », « Modifier mon identifiant de
 * connexion », « Modifier mon mot de passe ». Le message de la page en tête.
 */
export default async function ProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ motdepasse?: string }>;
}) {
  const { motdepasse } = await searchParams;
  const { user } = await requireSession();
  const profil = await apiFetch<{ identifiant: string; prenom: string; nom: string }>('/auth/profil')
    .catch(() => ({ identifiant: user.identifier ?? '', prenom: user.fullName, nom: '' }));
  const nomComplet = `${profil.prenom} ${profil.nom}`.trim() || '—';
  const role = user.roles.map((r) => ROLES[r] ?? r).join(', ') || '—';

  return (
    <>
      <PageHeader titre="Mon profil" sousTitre="Modifier mon identifiant, mon nom et mon mot de passe" />

      {/* Envoyé ici par la coquille tant que le mot de passe remis n'est pas
          remplacé — la phrase de son écran parent `changer_mdp.php`. */}
      {motdepasse === 'obligatoire' && (
        <div className="alert alert-info">Vous devez changer votre mot de passe avant de continuer.</div>
      )}

      <MessagePage>
        {/* Récapitulatif */}
        <div className="form-card">
          <h3>Identité actuelle</h3>
          <div className="profile-info-grid">
            <div>
              <strong>Identifiant de connexion</strong>
              <span>{profil.identifiant || '—'}</span>
            </div>
            <div>
              <strong>Nom complet</strong>
              <span>{nomComplet}</span>
            </div>
            <div>
              <strong>Rôle</strong>
              <span>{role}</span>
            </div>
          </div>
        </div>

        {/* Changer nom */}
        <div className="form-card">
          <h3>Modifier mon nom</h3>
          <NameForm prenom={profil.prenom} nom={profil.nom} />
        </div>

        {/* Changer identifiant */}
        <div className="form-card">
          <h3>Modifier mon identifiant de connexion</h3>
          <p className="text-muted" style={{ marginBottom: '1rem', fontSize: '.9rem' }}>
            Votre identifiant actuel est <strong>{profil.identifiant || '—'}</strong>.
            Le mot de passe actuel est requis pour confirmer ce changement.
          </p>
          <IdentifiantForm />
        </div>

        {/* Changer mot de passe */}
        <div className="form-card">
          <h3>Modifier mon mot de passe</h3>
          <p className="text-muted" style={{ marginBottom: '1rem', fontSize: '.9rem' }}>
            Minimum {PASSWORD_MIN_LENGTH} caractères, combinant au moins 3 types
            (minuscules, majuscules, chiffres, symboles).
          </p>
          <PasswordForm />
        </div>
      </MessagePage>
    </>
  );
}
