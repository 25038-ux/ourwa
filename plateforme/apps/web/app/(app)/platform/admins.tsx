'use client';

import { useActionState } from 'react';
import { createPlatformAdminAction, setPlatformAdminActiveAction } from '@/app/actions';

export interface AdminPlateforme {
  id: string;
  fullName: string;
  identifier: string;
  active: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  self: boolean;
}

type Result = { ok?: string; error?: string } | null;

function dateHeure(iso: string | null): string {
  if (!iso) return 'Jamais connecté';
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} à ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * LES ADMINISTRATEURS DE LA PLATEFORME — décision du propriétaire
 * (2026-09-14) : l'administrateur de toutes les branches en crée d'autres,
 * avec les mêmes privilèges que lui. Un mot de passe provisoire, à changer à
 * la première connexion ; désactivable (jamais soi-même, jamais le dernier).
 */
export function AdminsPlateforme({ admins }: { admins: AdminPlateforme[] }) {
  const [state, action, pending] = useActionState<Result, FormData>(createPlatformAdminAction, null);

  return (
    <>
      {state?.error && <div className="alert alert-error">{state.error}</div>}
      {state?.ok && <div className="alert alert-success">{state.ok}</div>}

      <div className="overflow-x" style={{ marginBottom: '1rem' }}>
        <table>
          <thead><tr><th>Nom</th><th>Identifiant</th><th>Dernière connexion</th><th>État</th><th>Action</th></tr></thead>
          <tbody>
            {admins.map((a) => (
              <tr key={a.id}>
                <td><strong>{a.fullName}</strong>{a.self && <span className="text-muted" style={{ marginLeft: '.5rem', fontSize: '.85rem' }}>(vous)</span>}</td>
                <td><code>{a.identifier}</code></td>
                <td>{dateHeure(a.lastLoginAt)}</td>
                <td><span className={`badge ${a.active ? 'badge-success' : 'badge-warning'}`}>{a.active ? 'Actif' : 'Désactivé'}</span></td>
                <td>{!a.self && <Basculer admin={a} />}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <form action={action}>
        <h4 style={{ marginTop: 0 }}>Créer un administrateur de la plateforme</h4>
        <div className="form-row">
          <div className="form-group">
            <label htmlFor="pa_nom">Nom complet *</label>
            <input id="pa_nom" name="fullName" type="text" maxLength={200} />
          </div>
          <div className="form-group">
            <label htmlFor="pa_id">Identifiant de connexion *</label>
            <input id="pa_id" name="identifier" type="text" maxLength={100} placeholder="ex. direction@groupe.mr" autoComplete="off" />
          </div>
        </div>
        <div className="form-group">
          <label htmlFor="pa_mdp">Mot de passe provisoire *</label>
          <input id="pa_mdp" name="password" type="password" autoComplete="new-password" />
          <span className="text-muted" style={{ fontSize: '.85rem' }}>Minimum 8 caractères, 3 types (minuscules, majuscules, chiffres, symboles). À changer à la première connexion.</span>
        </div>
        <button className="btn btn-primary" style={{ width: 'auto' }} disabled={pending}>Créer l&apos;administrateur</button>
      </form>
    </>
  );
}

function Basculer({ admin }: { admin: AdminPlateforme }) {
  const [state, action, pending] = useActionState<Result, FormData>(setPlatformAdminActiveAction, null);
  return (
    <form action={action} style={{ display: 'inline' }}>
      <input type="hidden" name="adminId" value={admin.id} />
      <input type="hidden" name="active" value={admin.active ? '0' : '1'} />
      <button
        className={`btn btn-sm ${admin.active ? 'btn-danger' : 'btn-secondary'}`}
        disabled={pending}
        onClick={(e) => { if (admin.active && !window.confirm(`Désactiver ${admin.fullName} ?`)) e.preventDefault(); }}
      >
        {admin.active ? 'Désactiver' : 'Activer'}
      </button>
      {state?.error && <span style={{ marginLeft: '.5rem', color: '#a8341f', fontSize: '.85rem' }}>{state.error}</span>}
    </form>
  );
}
