import { ExpulserForm } from './expulser-form';

/**
 * LES DEUX FICHES DE `recherche.php`.
 *
 * ⚠ SA RECHERCHE MÈNE QUELQUE PART. Sa colonne « Action » ouvre
 * `recherche.php?type=etudiant&profil_id=…` : une carte à médaillon, neuf
 * renseignements, le relevé des notes, « ← Retour » et « ⚠ Expell ». La nôtre
 * rendait quatre colonnes et pas un lien — l'accueil trouvait un enfant et ne
 * pouvait rien en faire.
 *
 * L'URL est la sienne, sur la même page, pour que « ← Retour » ramène à la
 * recherche telle qu'elle était plutôt qu'à une recherche vide.
 */

export interface Etudiant {
  id: string;
  first_name: string;
  last_name: string;
  sex: string | null;
  rim: string | null;
  national_id: string | null;
  matricule: string | null;
  level_name: string | null;
  group_name: string | null;
  guardian_name: string | null;
  guardian_phone: string | null;
  monthly_fee: string | null;
  enrolled_at: string | null;
  has_left: boolean;
}

export interface Note {
  term: number;
  subject: string;
  kind: string;
  score: string;
  teacher: string | null;
}

export interface Professeur {
  id: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  employment: string | null;
  hourly_rate: string;
  salary: string;
  classes: number;
  hours_per_month: number;
  identifier: string | null;
  last_seen: string | null;
}

export interface Enseignement {
  level_name: string | null;
  group_name: string;
  subject_name: string;
}

/** Ses initiales, en majuscules — le médaillon de la carte. */
function initiales(prenom: string, nom: string): string {
  return `${prenom.charAt(0)}${nom.charAt(0)}`.toUpperCase();
}

/** `number_format($x, 0, ',', ' ')` — sa façon d'écrire un montant. */
function montant(value: string | null): string {
  if (value === null) return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  return n.toLocaleString('fr-FR', { maximumFractionDigits: 0 }).replace(/ | /g, ' ');
}

/** Sa `derniere_connexion` telle quelle : « YYYY-MM-DD HH:MM:SS ». */
function dateSql(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** `date('d/m/Y')`. */
function jour(iso: string | null): string {
  if (!iso) return '—';
  const [a, m, j] = iso.slice(0, 10).split('-');
  return `${j}/${m}/${a}`;
}

export function FicheEtudiant({
  etudiant,
  notes,
  retour,
  peutExpulser,
}: {
  etudiant: Etudiant;
  notes: Note[];
  retour: string;
  peutExpulser: boolean;
}) {
  const sexe =
    etudiant.sex === 'M' ? 'Masculin' : etudiant.sex === 'F' ? 'Féminin' : '—';

  return (
    <div className="profile-card">
      <div className="profile-header-card">
        <div className="profile-avatar">
          {initiales(etudiant.first_name, etudiant.last_name)}
        </div>
        <div>
          <h2>
            {etudiant.first_name} {etudiant.last_name}
          </h2>
          <p className="text-muted">
            {etudiant.matricule ?? ''} — {etudiant.level_name ?? ''} / {etudiant.group_name ?? ''}
          </p>
        </div>
      </div>

      <div className="profile-info-grid">
        <div>
          <strong>Niveau :</strong>{' '}
          <span className="badge badge-primary">{etudiant.level_name ?? '—'}</span>
        </div>
        <div>
          <strong>Groupe :</strong> {etudiant.group_name ?? '—'}
        </div>
        <div>
          <strong>Sexe :</strong> {sexe}
        </div>
        <div>
          <strong>Parent :</strong> {etudiant.guardian_name ?? '—'}
        </div>
        <div>
          <strong>Tél. parent :</strong> {etudiant.guardian_phone ?? '—'}
        </div>
        <div>
          <strong>NNI :</strong> <code>{etudiant.national_id || '—'}</code>
        </div>
        <div>
          <strong>RIM :</strong> <code>{etudiant.rim || '—'}</code>
        </div>
        <div>
          {/* ⚠ LE TARIF DE SON INSCRIPTION, pas celui du niveau. Une famille qui
              a obtenu une remise paie ce que porte SA ligne ; afficher le tarif
              du niveau dirait à l'accueil un chiffre que la famille ne
              reconnaîtra pas. */}
          <strong>Tarif mensuel :</strong> {montant(etudiant.monthly_fee)} MRU
        </div>
        <div>
          <strong>Inscrit le :</strong> {jour(etudiant.enrolled_at)}
        </div>
      </div>

      {notes.length > 0 && (
        <>
          <h3 style={{ marginTop: '1.5rem' }}>Notes</h3>
          <div className="overflow-x">
            <table>
              <thead>
                <tr>
                  <th>Trimestre</th>
                  <th>Matière</th>
                  <th>Type</th>
                  <th>Note</th>
                  <th>Professeur</th>
                </tr>
              </thead>
              <tbody>
                {notes.map((n, i) => (
                  <tr key={`${n.term}-${n.subject}-${n.kind}-${i}`}>
                    <td>T{n.term}</td>
                    <td>{n.subject}</td>
                    <td>
                      <span
                        className={`badge ${n.kind === 'exam' ? 'badge-warning' : 'badge-primary'}`}
                      >
                        {n.kind === 'exam' ? 'Examen' : 'Devoir'}
                      </span>
                    </td>
                    <td>
                      {/* ⚠ `-1` EST UN MARQUEUR D'ABSENCE, PAS UNE NOTE. L'écrire
                          « -1.00/20 » invite à le moyenner ; il s'écrit donc en
                          toutes lettres, et rien n'est calculé sur cette page. */}
                      {Number(n.score) === -1 ? (
                        <span className="badge badge-warning">Absent</span>
                      ) : (
                        <strong>{Number(n.score).toFixed(2)}/20</strong>
                      )}
                    </td>
                    <td>{n.teacher ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <div style={{ display: 'flex', gap: '.5rem', marginTop: '1.5rem', flexWrap: 'wrap' }}>
        <a href={retour} className="btn btn-secondary" style={{ width: 'auto' }}>
          ← Retour
        </a>
        {peutExpulser && <ExpulserForm etudiant={etudiant} />}
      </div>
    </div>
  );
}

export function FicheProfesseur({
  professeur,
  enseignements,
  retour,
}: {
  professeur: Professeur;
  enseignements: Enseignement[];
  retour: string;
}) {
  return (
    <div className="profile-card">
      <div className="profile-header-card">
        <div className="profile-avatar" style={{ background: 'var(--primary)' }}>
          {initiales(professeur.first_name, professeur.last_name)}
        </div>
        <div>
          <h2>
            {professeur.first_name} {professeur.last_name}
          </h2>
          <p className="text-muted">Professeur — {professeur.identifier ?? '—'}</p>
        </div>
      </div>

      <div className="profile-info-grid">
        <div>
          <strong>Téléphone :</strong> {professeur.phone ?? '—'}
        </div>
        <div>
          <strong>Classes :</strong> {professeur.classes}
        </div>
        <div>
          <strong>Heures/mois :</strong> {professeur.hours_per_month}h
        </div>
        <div>
          <strong>Tarif horaire :</strong> {montant(professeur.hourly_rate)} MRU/h
        </div>
        <div>
          <strong>Salaire :</strong> {montant(professeur.salary)} MRU
        </div>
        <div>
          {/* Sa `derniere_connexion` telle quelle, ou « Jamais ». */}
          <strong>Dernière connexion :</strong>{' '}
          {professeur.last_seen ? dateSql(professeur.last_seen) : 'Jamais'}
        </div>
      </div>

      {enseignements.length > 0 && (
        <>
          <h3 style={{ marginTop: '1.5rem' }}>Enseignements (par Niveau)</h3>
          <div className="overflow-x">
            <table>
              <thead>
                <tr>
                  <th>Niveau</th>
                  <th>Groupe</th>
                  <th>Matière</th>
                </tr>
              </thead>
              <tbody>
                {enseignements.map((e, i) => (
                  <tr key={`${e.group_name}-${e.subject_name}-${i}`}>
                    <td>
                      <span className="badge badge-primary">{e.level_name ?? '—'}</span>
                    </td>
                    <td>
                      <strong>{e.group_name}</strong>
                    </td>
                    <td>{e.subject_name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <a href={retour} className="btn btn-secondary mt-2" style={{ width: 'auto' }}>
        ← Retour
      </a>
    </div>
  );
}
