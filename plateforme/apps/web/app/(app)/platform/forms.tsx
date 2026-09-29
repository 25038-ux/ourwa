'use client';

import { useActionState, useEffect, useId, useState } from 'react';
import { createBranchAction } from '@/app/actions';
import { hoteAvecSlug } from '@elourwa/shared/tenant-slug';

export function CreateBranchForm() {
  // Le domaine de cette console, lu dans le navigateur (plus localhost:3000 en dur).
  const [domaine, setDomaine] = useState('…');
  useEffect(() => {
    setDomaine(window.location.host.replace(/^[^.]+\./, ''));
  }, []);
  const [state, action, pending] = useActionState(
    createBranchAction,
    null as { ok?: string; error?: string } | null,
  );
  const [slug, setSlug] = useState('');
  const id = useId();

  return (
    <form action={action} className="elw-stack">
      {state?.error && (
        <p className="alert alert-error" role="alert"><span>{state.error}</span></p>
      )}
      {state?.ok && <p className="alert alert-success" role="status"><span>{state.ok}</span></p>}

      <div className="form-row">
        <div className="form-group">
          <label htmlFor={`${id}-name`}>Nom</label>
          <input id={`${id}-name`} name="name" type="text" required placeholder="École Amana" />
        </div>
        <div className="form-group">
          <label htmlFor={`${id}-ar`}>Nom en arabe</label>
          <input id={`${id}-ar`} name="nameAr" type="text" dir="rtl" lang="ar" />
        </div>
      </div>

      <div className="form-row">
        <div className="form-group">
          <label htmlFor={`${id}-slug`}>Identifiant</label>
          <input
            id={`${id}-slug`}
            name="slug"
            type="text"
            required
            pattern="[a-z][a-z0-9-]{1,30}"
            value={slug}
            onChange={(e) => setSlug(e.target.value.toLowerCase())}
            placeholder="amana"
            aria-describedby={`${id}-slug-help`}
          />
          {/* Shows the actual address the school will use, as it is typed. */}
          <span className="text-muted micro" id={`${id}-slug-help`}>
            {slug ? `${slug}.${domaine}` : 'minuscules, chiffres et tirets'}
          </span>
        </div>
        <div className="form-group">
          <label htmlFor={`${id}-currency`}>Devise</label>
          <input
            id={`${id}-currency`}
            name="currency"
            type="text"
            maxLength={3}
            defaultValue="MRU"
          />
        </div>
        <div className="form-group">
          <label htmlFor={`${id}-emoji`}>Emblème</label>
          <input id={`${id}-emoji`} name="logoEmoji" type="text" maxLength={4} defaultValue="🎓" />
        </div>
        <div className="form-group">
          <label htmlFor={`${id}-colour`}>Couleur</label>
          <input
            id={`${id}-colour`}
            name="themeColor"
            type="color"
            defaultValue="#0f766e"
            className="colour"
          />
        </div>
      </div>

      <button type="submit" className="btn" disabled={pending}>
        {pending ? 'Création…' : 'Créer la branche'}
      </button>
    </form>
  );
}

/**
 * Enter a branch as the platform administrator.
 *
 * Confirmed deliberately. This is the one sanctioned crossing of a tenant
 * boundary, every use is written to the audit log under the administrator's own
 * name, and acting in the wrong school by accident is precisely the failure the
 * confirmation and the banner exist to prevent.
 */
export function EnterBranchButton({
  id,
  slug,
  name,
}: {
  id: string;
  slug: string;
  name: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function enter() {
    if (!window.confirm(`Entrer dans ${name} en tant qu'administrateur plateforme ?\n\nCette session est limitée à 30 minutes et sera journalisée.`)) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/platform/enter`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ branchId: id, slug }),
      });
      if (!response.ok) {
        setError('Entrée refusée.');
        return;
      }
      // ⚠ VISAIT `http://<slug>.localhost:3000/` EN DUR : sur le serveur en
      // ligne, « Entrer » envoyait l'administrateur sur sa propre machine. Le
      // même hôte que la console, première étiquette remplacée par l'école.
      window.location.href = `${window.location.protocol}//${hoteAvecSlug(window.location.host, slug)}/`;
    } catch {
      setError('Le serveur ne répond pas.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" className="btn-ghost" onClick={enter} disabled={busy}>
        {busy ? 'Entrée…' : 'Entrer'}
      </button>
      {error && <span className="text-muted micro" style={{ color: 'var(--danger)' }}> {error}</span>}
    </>
  );
}
