'use client';

import { createContext, useActionState, useCallback, useContext, useState } from 'react';
import {
  staffActifAction,
  staffIdentifiantAction,
  staffIdentiteAction,
  staffMdpAction,
  staffRolesAction,
} from '@/app/actions';

export interface Compte {
  id: string;
  identifiant: string;
  prenom: string | null;
  nom: string | null;
  telephone: string | null;
  fonction: string | null;
  est_professeur: boolean;
  actif: boolean;
  derniere_connexion: string | null;
  date_creation: string;
  bloque_jusqua: string | null;
  mdp_reinitialise_le: string | null;
  roles: { code: string; libelle: string }[];
}

type Role = { code: string; label: string; description: string | null };
type Message = { type: 'success' | 'error'; texte: string } | null;
type Mdp = { identifiant: string; mdp: string; nom: string } | null;
type Etat = { ok?: string; error?: string; mdp?: Mdp } | null;
type Simple = { ok?: string; error?: string } | null;

/** Le `$message` et le `$mdp_a_montrer` de la page, alimentés par les cartes. */
const Ctx = createContext<(e: Etat) => void>(() => {});

/** Son `date('d/m/Y à H:i', …)`. */
function dateHeure(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} à ${p(d.getHours())}:${p(d.getMinutes())}`;
}
/** Son `date('d/m/Y', …)`. */
function dateJour(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/**
 * Une action dont le résultat monte en tête de page (message, mot de passe).
 * Publié au retour de l'action — une fois, dans l'ordre — plutôt que dans un
 * effet : après le rafraîchissement du serveur, un compte désactivé change de
 * place dans la liste et les effets des formulaires voisins se rejouaient,
 * ramenant un message plus ancien par-dessus le dernier.
 */
function useActionPubliee<S extends NonNullable<Etat>>(fn: (prev: unknown, form: FormData) => Promise<S>) {
  const publier = useContext(Ctx);
  const enveloppe = async (prev: S | null, form: FormData): Promise<S | null> => {
    const r = await fn(prev, form);
    publier(r);
    return r;
  };
  return useActionState<S | null, FormData>(enveloppe, null);
}

/**
 * LA PAGE, SOUS L'EN-TÊTE — son `div.st-wrap` : le message, le mot de passe
 * provisoire (« affiché une seule fois, jamais stocké en clair »), les
 * compteurs, le renvoi vers la création, la liste des cartes ou son vide.
 */
export function ComptesPersonnel({
  comptes,
  catalogue,
  moi,
  peutReinitialiser,
}: {
  comptes: Compte[];
  catalogue: Role[];
  moi: string;
  peutReinitialiser: boolean;
}) {
  const [message, setMessage] = useState<Message>(null);
  const [mdp, setMdp] = useState<Mdp>(null);
  // Stable : les cartes le lisent dans un effet, et une fonction refaite à
  // chaque rendu relancerait l'effet sans fin.
  const publier = useCallback((e: Etat) => {
    if (!e) return;
    if (e.error) setMessage({ type: 'error', texte: e.error });
    else if (e.ok) setMessage({ type: 'success', texte: e.ok });
    // Sa page se recharge à chaque POST : le mot de passe montré est celui de CE POST.
    setMdp(e.mdp ?? null);
  }, []);
  const actifs = comptes.filter((c) => c.actif).length;
  const inactifs = comptes.length - actifs;

  return (
    <Ctx.Provider value={publier}>
      <div className="st-wrap">
        {message && (
          <div className={`alert alert-${message.type}`} role="status">{message.texte}</div>
        )}

        {mdp && (
          <div className="st-mdp" role="alert">
            <strong>Mot de passe provisoire de {mdp.nom}</strong>
            <p style={{ margin: '.5rem 0 .35rem' }}>
              Identifiant <code>{mdp.identifiant}</code>
              &nbsp;·&nbsp; mot de passe <code>{mdp.mdp}</code>
            </p>
            <p style={{ margin: 0, fontSize: '.85rem' }}>
              Il n&apos;est stocké que sous forme hachée : cette ligne est le seul endroit où il apparaît en clair.
              Notez-le maintenant, puis demandez à l&apos;agent de le changer à sa première connexion.
            </p>
          </div>
        )}

        <div className="st-stats">
          <div className="st-stat"><b>{comptes.length}</b><span>Comptes</span></div>
          <div className="st-stat"><b>{actifs}</b><span>Actifs</span></div>
          <div className="st-stat"><b>{inactifs}</b><span>Désactivés</span></div>
          <div className="st-stat"><b>{catalogue.length}</b><span>Rôles</span></div>
        </div>

        {/* « La creation de compte vit dans "Creer un utilisateur", qui gere aussi
            les professeurs et le cumul de roles. » */}
        <p style={{ margin: '0 0 1rem', display: 'flex', gap: '.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <a className="st-btn go" href="/comptes/creer">＋ Créer un compte</a>
          <span className="text-muted" style={{ fontSize: '.82rem' }}>
            La création — personnel comme professeurs — se fait dans « Créer un utilisateur ».
          </span>
        </p>

        {comptes.length === 0 && (
          <div className="st-empty">
            <p style={{ margin: '0 0 .3rem', fontWeight: 600 }}>Aucun compte de personnel</p>
            <p style={{ margin: 0, fontSize: '.9rem' }}>Les comptes des professeurs se gèrent dans « Comptes des professeurs ».</p>
          </div>
        )}

        {comptes.map((c) => (
          <CarteCompte key={c.id} c={c} catalogue={catalogue} moi={moi} peutReinitialiser={peutReinitialiser} />
        ))}
      </div>
    </Ctx.Provider>
  );
}

/**
 * UNE CARTE — sa `.st-card` : l'identité, les pastilles de rôles et l'état,
 * les actions ; puis ses trois panneaux (`stPanel()` : chacun se replie et se
 * déplie indépendamment, et le premier champ prend le focus).
 */
function CarteCompte({
  c,
  catalogue,
  moi,
  peutReinitialiser,
}: {
  c: Compte;
  catalogue: Role[];
  moi: string;
  peutReinitialiser: boolean;
}) {
  const [ouverts, setOuverts] = useState<Record<string, boolean>>({});
  const basculer = (p: 'e' | 'r' | 'i') => {
    setOuverts((o) => {
      const suivant = { ...o, [p]: !o[p] };
      if (suivant[p]) {
        // « var f = p.querySelector('input:not([type=hidden]),select'); if (f) f.focus(); »
        setTimeout(() => {
          document.getElementById(`p-${p}${c.id}`)?.querySelector<HTMLElement>('input:not([type=hidden]),select')?.focus();
        }, 0);
      }
      return suivant;
    });
  };

  const rls = c.roles.length > 0 ? c.roles : [];
  const codes = rls.map((r) => r.code);
  const nomComplet = `${c.prenom ?? ''} ${c.nom ?? ''}`.trim() || c.identifiant;
  const bloque = c.bloque_jusqua !== null && new Date(c.bloque_jusqua).getTime() > Date.now();

  return (
    <div className={`st-card ${c.actif ? '' : 'off'}`}>
      <div className="st-head">
        <div className="st-id">
          <p className="st-name">{nomComplet}</p>
          <div className="st-meta">
            <code>{c.identifiant}</code>
            {c.fonction && <> · {c.fonction}</>}
            {c.telephone && <> · {c.telephone}</>}
            <br />
            {c.derniere_connexion ? `Dernière connexion le ${dateHeure(c.derniere_connexion)}` : 'Jamais connecté'}
            {c.mdp_reinitialise_le && <> · mot de passe réinitialisé le {dateJour(c.mdp_reinitialise_le)}</>}
          </div>
          <div className="st-roles">
            {rls.map((r) => <span key={r.code} className="st-role">{r.libelle}</span>)}
            <span className={`st-flag ${c.actif ? 'st-on' : 'st-offb'}`}>{c.actif ? 'Actif' : 'Désactivé'}</span>
            {bloque && <span className="st-flag st-offb">Verrouillé (tentatives)</span>}
          </div>
        </div>
        <div className="st-acts">
          <button type="button" className="st-btn" onClick={() => basculer('e')} aria-controls={`p-e${c.id}`} aria-expanded={!!ouverts.e}>Modifier</button>
          <button type="button" className="st-btn" onClick={() => basculer('r')} aria-controls={`p-r${c.id}`} aria-expanded={!!ouverts.r}>Rôles</button>
          <button type="button" className="st-btn" onClick={() => basculer('i')} aria-controls={`p-i${c.id}`} aria-expanded={!!ouverts.i}>Identifiant</button>
          {peutReinitialiser && <FormMdp c={c} nomComplet={nomComplet} />}
          <FormActif c={c} nomComplet={nomComplet} moi={moi} />
        </div>
      </div>

      <div className={`st-panel st-f${ouverts.e ? ' open' : ''}`} id={`p-e${c.id}`}>
        <FormModifier c={c} />
      </div>
      <div className={`st-panel st-f${ouverts.r ? ' open' : ''}`} id={`p-r${c.id}`}>
        <FormRoles c={c} catalogue={catalogue} codes={codes} />
      </div>
      <div className={`st-panel st-f${ouverts.i ? ' open' : ''}`} id={`p-i${c.id}`}>
        <FormIdentifiant c={c} />
      </div>
    </div>
  );
}

/** Son formulaire `mdp` : un `confirm`, puis le mot de passe provisoire en tête de page. */
function FormMdp({ c, nomComplet }: { c: Compte; nomComplet: string }) {
  const [, action, pending] = useActionPubliee<NonNullable<Etat>>(staffMdpAction);
  return (
    <form
      action={action}
      style={{ display: 'inline' }}
      onSubmit={(e) => {
        if (!window.confirm(`Réinitialiser le mot de passe de ${nomComplet} ?\n\nL'ancien mot de passe cessera immédiatement de fonctionner.`)) e.preventDefault();
      }}
    >
      <input type="hidden" name="utilisateur_id" value={c.id} />
      <input type="hidden" name="identifiant" value={c.identifiant} />
      <input type="hidden" name="nom_complet" value={nomComplet} />
      <button className="st-btn warn" type="submit" disabled={pending}>Mot de passe</button>
    </form>
  );
}

/** Son formulaire `actif` : Désactiver (avec `confirm`, interdit sur soi-même) ou Activer. */
function FormActif({ c, nomComplet, moi }: { c: Compte; nomComplet: string; moi: string }) {
  const [, action, pending] = useActionPubliee<NonNullable<Simple>>(staffActifAction);
  if (c.actif) {
    return (
      <form
        action={action}
        style={{ display: 'inline' }}
        onSubmit={(e) => {
          if (!window.confirm(`Désactiver le compte de ${nomComplet} ?\n\nIl ne pourra plus se connecter. Son historique est conservé et le compte reste réactivable.`)) e.preventDefault();
        }}
      >
        <input type="hidden" name="utilisateur_id" value={c.id} />
        <input type="hidden" name="vers" value="0" />
        <button
          className="st-btn warn"
          type="submit"
          disabled={pending || c.id === moi}
          title={c.id === moi ? 'Vous ne pouvez pas désactiver votre propre compte' : undefined}
        >
          Désactiver
        </button>
      </form>
    );
  }
  return (
    <form action={action} style={{ display: 'inline' }}>
      <input type="hidden" name="utilisateur_id" value={c.id} />
      <input type="hidden" name="vers" value="1" />
      <button className="st-btn go" type="submit" disabled={pending}>Activer</button>
    </form>
  );
}

/** Son panneau `modifier` : Prénom *, Nom *, Téléphone, Fonction — « Enregistrer ». */
function FormModifier({ c }: { c: Compte }) {
  const [, action, pending] = useActionPubliee<NonNullable<Simple>>(staffIdentiteAction);
  return (
    <form action={action}>
      <input type="hidden" name="utilisateur_id" value={c.id} />
      <div className="st-grid">
        <div>
          <label htmlFor={`e${c.id}-p`}>Prénom *</label>
          <input id={`e${c.id}-p`} name="prenom" required maxLength={100} defaultValue={c.prenom ?? ''} />
        </div>
        <div>
          <label htmlFor={`e${c.id}-n`}>Nom *</label>
          <input id={`e${c.id}-n`} name="nom" required maxLength={100} defaultValue={c.nom ?? ''} />
        </div>
        <div>
          <label htmlFor={`e${c.id}-t`}>Téléphone</label>
          <input id={`e${c.id}-t`} name="telephone" inputMode="tel" maxLength={20} defaultValue={c.telephone ?? ''} />
        </div>
        <div>
          <label htmlFor={`e${c.id}-f`}>Fonction</label>
          <input id={`e${c.id}-f`} name="fonction" maxLength={100} defaultValue={c.fonction ?? ''} />
        </div>
      </div>
      <p style={{ margin: '.9rem 0 0' }}><button className="st-btn go" type="submit" disabled={pending}>Enregistrer</button></p>
    </form>
  );
}

/** Son panneau `roles` : une case par rôle attribuable, avec sa description. */
function FormRoles({ c, catalogue, codes }: { c: Compte; catalogue: Role[]; codes: string[] }) {
  const [, action, pending] = useActionPubliee<NonNullable<Simple>>(staffRolesAction);
  return (
    <form action={action}>
      <input type="hidden" name="utilisateur_id" value={c.id} />
      <div className="st-grid">
        {catalogue.map((r) => (
          <label key={r.code} className="st-check">
            <input type="checkbox" name="roles[]" value={r.code} defaultChecked={codes.includes(r.code)} />
            <span><b>{r.label}</b><span>{r.description ?? ''}</span></span>
          </label>
        ))}
      </div>
      <p style={{ margin: '.9rem 0 0', display: 'flex', gap: '.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <button className="st-btn go" type="submit" disabled={pending}>Enregistrer les rôles</button>
        <span style={{ fontSize: '.82rem', color: 'var(--st-mut)' }}>
          Les permissions sont l&apos;union des rôles cochés, et s&apos;appliquent dès la prochaine page.
        </span>
      </p>
    </form>
  );
}

/** Son panneau `identifiant` : « Nouvel identifiant * », avec `confirm`. */
function FormIdentifiant({ c }: { c: Compte }) {
  const [, action, pending] = useActionPubliee<NonNullable<Simple>>(staffIdentifiantAction);
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!window.confirm("Changer l'identifiant de connexion ?\n\nL'agent devra utiliser le nouvel identifiant dès sa prochaine connexion.")) e.preventDefault();
      }}
    >
      <input type="hidden" name="utilisateur_id" value={c.id} />
      <div className="st-grid">
        <div>
          <label htmlFor={`i${c.id}`}>Nouvel identifiant *</label>
          <input
            id={`i${c.id}`}
            name="identifiant"
            required
            minLength={3}
            maxLength={100}
            pattern="[A-Za-z0-9._@\-]+"
            defaultValue={c.identifiant}
            autoComplete="off"
          />
        </div>
      </div>
      <p style={{ margin: '.9rem 0 0' }}><button className="st-btn go" type="submit" disabled={pending}>Changer l&apos;identifiant</button></p>
    </form>
  );
}
