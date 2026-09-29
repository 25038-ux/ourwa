'use client';

import { useEffect, useRef, useState } from 'react';
import { sendMessageAction } from '@/app/actions';
import { useActionMessage } from '@/components/message-page';

export interface Niveau {
  id: string;
  name: string;
}

export interface Groupe {
  id: string;
  name: string;
  levelId: string | null;
}

interface ParentTrouve {
  id: string;
  fullName: string;
  phone: string | null;
}

/**
 * MESSAGERIE PARENTS — le formulaire de `messagerie.php` : une carte
 * (`max-width:780px`), « Nouveau message », sa phrase, le fieldset
 * « A. Cibler UN parent » (recherche par nom ou téléphone — sa liste de
 * boutons radio, « Aucun parent trouvé. », « ✓ Parent sélectionné : … »),
 * « — OU — », le fieldset « B. Diffuser à un Niveau (et éventuellement à un
 * Groupe) », Sujet *, Message *, « Envoyer ». Ses deux modes s'effacent
 * l'un l'autre (`selectionnerParent()` / `majGroupes()`), et son contrôle à
 * l'envoi : « Veuillez sélectionner un parent OU un niveau. » /
 * « Vous ne pouvez pas utiliser les deux options en même temps. »
 */
export function ComposeForm({
  niveaux,
  groupes,
  academicYearId,
}: {
  niveaux: Niveau[];
  groupes: Groupe[];
  academicYearId: string | null;
}) {
  const [state, action, pending] = useActionMessage(sendMessageAction);

  const form = useRef<HTMLFormElement | null>(null);

  const [qp, setQp] = useState('');
  const [resultats, setResultats] = useState<ParentTrouve[] | null>(null);
  const [parentId, setParentId] = useState('');
  const [parentLibelle, setParentLibelle] = useState('');
  const [niveauId, setNiveauId] = useState('');
  const [groupeId, setGroupeId] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sa page se recharge après l'envoi : le formulaire est vide.
  useEffect(() => {
    if (state?.ok) {
      form.current?.reset();
      setQp(''); setResultats(null); setParentId(''); setParentLibelle(''); setNiveauId(''); setGroupeId('');
    }
  }, [state]);

  // Son `rechercheParent()` : 600 ms après la frappe, deux caractères au moins.
  const rechercheParent = (val: string) => {
    setQp(val);
    if (timer.current) clearTimeout(timer.current);
    if (val.length < 2) { setResultats(null); return; }
    timer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/guardians/search?q=${encodeURIComponent(val)}&actifs=1&limit=30`);
        setResultats(res.ok ? ((await res.json()) as ParentTrouve[]) : []);
      } catch {
        setResultats([]);
      }
    }, 600);
  };

  // Son `selectionnerParent()` : efface le niveau et le groupe.
  const selectionnerParent = (p: ParentTrouve) => {
    setParentId(p.id);
    setParentLibelle(`${p.fullName} — ${p.phone ?? ''}`);
    setNiveauId('');
    setGroupeId('');
  };

  // Son `majGroupes()` : efface le parent choisi.
  const majGroupes = (nv: string) => {
    setNiveauId(nv);
    setGroupeId('');
    setParentId('');
    setParentLibelle('');
  };

  const groupesDuNiveau = niveauId ? groupes.filter((g) => g.levelId === niveauId) : [];

  return (
    <form
      ref={form}
      action={action}
      className="form-card"
      style={{ maxWidth: 780 }}
      id="form-messagerie"
      onSubmit={(e) => {
        if (!parentId && !niveauId) { e.preventDefault(); window.alert('Veuillez sélectionner un parent OU un niveau.'); }
        else if (parentId && niveauId) { e.preventDefault(); window.alert('Vous ne pouvez pas utiliser les deux options en même temps.'); }
      }}
    >
      {academicYearId && <input type="hidden" name="academicYearId" value={academicYearId} />}

      <h3 style={{ marginTop: 0 }}>Nouveau message</h3>
      <p className="text-muted" style={{ fontSize: '.88rem', marginBottom: '1.5rem' }}>
        Choisissez <strong>UNE</strong> des deux méthodes ci-dessous. Au moins une est obligatoire.
      </p>

      <fieldset id="mode-individuel" style={{ border: '2px solid var(--border)', borderRadius: 'var(--radius)', padding: '1rem', marginBottom: '1rem' }}>
        <legend style={{ padding: '0 .5rem', fontWeight: 600, color: 'var(--primary)' }}>A. Cibler UN parent</legend>
        <div className="form-group">
          <label htmlFor="qp">Rechercher un parent (nom ou téléphone)</label>
          <input type="text" id="qp" placeholder="Tapez au moins 2 caractères..." value={qp} onChange={(e) => rechercheParent(e.target.value)} />
          <div
            id="resultats-parents"
            style={{ marginTop: '.5rem', maxHeight: 220, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8, display: resultats !== null ? 'block' : 'none' }}
          >
            {(resultats ?? []).map((p) => (
              <label
                key={p.id}
                style={{ display: 'flex', gap: '.6rem', alignItems: 'center', padding: '.55rem .75rem', borderBottom: '1px solid var(--border)', cursor: 'pointer' }}
                onClick={() => selectionnerParent(p)}
              >
                <input type="radio" name="_choix_parent" value={p.id} checked={parentId === p.id} onChange={() => selectionnerParent(p)} style={{ margin: 0 }} />
                <div>
                  <strong>{p.fullName}</strong>{' '}
                  <small className="text-muted">— {p.phone ?? ''}</small>
                </div>
              </label>
            ))}
            {resultats !== null && resultats.length === 0 && (
              <p style={{ padding: '.75rem', color: 'var(--text-muted)', textAlign: 'center', margin: 0 }}>Aucun parent trouvé.</p>
            )}
          </div>
        </div>
        <input type="hidden" name="parent_id" id="parent_id" value={parentId} />
        <div id="parent-choisi" style={{ marginTop: '.5rem', fontSize: '.9rem', color: 'var(--success)', fontWeight: 600 }}>
          {parentId ? `✓ Parent sélectionné : ${parentLibelle}` : ''}
        </div>
      </fieldset>

      <p style={{ textAlign: 'center', margin: '1rem 0', color: 'var(--text-muted)', fontWeight: 600 }}>— OU —</p>

      <fieldset id="mode-diffusion" style={{ border: '2px solid var(--border)', borderRadius: 'var(--radius)', padding: '1rem', marginBottom: '1rem' }}>
        <legend style={{ padding: '0 .5rem', fontWeight: 600, color: 'var(--primary)' }}>B. Diffuser à un Niveau (et éventuellement à un Groupe)</legend>
        <div className="form-row">
          <div className="form-group">
            <label htmlFor="niveau_id">Niveau</label>
            <select name="niveau_id" id="niveau_id" value={niveauId} onChange={(e) => majGroupes(e.target.value)}>
              <option value="">— Choisir un niveau —</option>
              {niveaux.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label htmlFor="groupe_id">Groupe (laisser vide = tous les groupes)</label>
            <select name="groupe_id" id="groupe_id" value={groupeId} onChange={(e) => setGroupeId(e.target.value)} disabled={!niveauId}>
              <option value="">— Tous les groupes du niveau —</option>
              {groupesDuNiveau.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </div>
        </div>
      </fieldset>

      <div className="form-group"><label>Sujet *</label><input type="text" name="sujet" required maxLength={200} /></div>
      <div className="form-group"><label>Message *</label><textarea name="contenu" rows={6} required /></div>

      <button type="submit" className="btn btn-primary" style={{ width: 'auto' }} disabled={pending}>Envoyer</button>
    </form>
  );
}
