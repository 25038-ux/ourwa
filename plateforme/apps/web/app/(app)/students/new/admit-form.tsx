'use client';

import { useState } from 'react';
import { admitStudentAction } from '@/app/actions';
import { useActionMessage } from '@/components/message-page';
import { RechercheParent } from '@/components/recherche-parent';
import { FenetreEncaissement, type FenetreData } from '@/components/fenetre-encaissement';
import type { Moyen } from '@/components/moyens-paiement';
import { fr } from '@/components/moyens-paiement';
import { MotDePasseGenere } from '@/components/mot-de-passe-genere';
import {
  ChoixFacturation,
  montantChamp,
  tarifDuMode,
  type CatalogueFacturation,
} from '@/components/choix-facturation';
import type { ModeEtude } from '@elourwa/shared/facturation';

interface Group {
  id: string;
  name: string;
  level_id?: string | null;
  level_name: string | null;
  capacity: number;
  headcount: number;
  monthly_rate: string | null;
}

type Result =
  | {
      ok?: string;
      error?: string;
      password?: string | null;
      guardianPhone?: string | null;
      fenetre?: FenetreData;
    }
  | null;

/**
 * INSCRIRE UN ÉTUDIANT — le formulaire de `inscrire_etudiant.php` : « Informations
 * de l'étudiant » en grille à deux colonnes (Prénom, Nom, RIM, NNI, Sexe, Date
 * et Lieu de naissance, Groupe « Niveau — Groupe (effectif/capacité) » dont le
 * choix remplit « Frais mensuel (MRU) » — son `majFrais()`), puis « Correspondant
 * (parent) » : « Parent existant » (recherche + liste) ou « Nouveau parent »
 * (nom, téléphone, email, mot de passe initial). Réussie, la fenêtre
 * d'encaissement s'ouvre d'elle-même.
 */
export function AdmitForm({
  groups,
  academicYearId,
  moyens,
  facturation = null,
}: {
  groups: Group[];
  academicYearId: string;
  moyens: Moyen[];
  /**
   * École « services » (Jinan, spécification §8) : le catalogue de l'année.
   * Présent, le formulaire exige le mode d'étude, pré-remplit la mensualité
   * par niveau ET par mode, dit les frais d'inscription et propose les
   * services. Absent (école « famille »), il reste celui d'El Ourwa.
   */
  facturation?: CatalogueFacturation | null;
}) {
  const [state, action, pending] = useActionMessage(admitStudentAction);

  const [family, setFamily] = useState<'existant' | 'nouveau'>('existant');
  const [fee, setFee] = useState('0');
  const [groupeId, setGroupeId] = useState('');
  const [mode, setMode] = useState<ModeEtude | null>(null);
  const levelId = groups.find((g) => g.id === groupeId)?.level_id ?? null;
  /** École « services » : la mensualité suit le niveau ET le mode. */
  const preRemplir = (lvl: string | null, m: ModeEtude | null) => {
    if (!facturation) return;
    setFee(montantChamp(tarifDuMode(facturation, lvl, m)));
  };

  if (state?.fenetre) {
    const e = state.fenetre.eleve;
    return (
      <FenetreEncaissement
        data={state.fenetre}
        moyens={moyens}
        titre="Inscription réussie — encaisser"
        sousTitre={`${e.niveau_nom ?? '—'} / ${e.groupe_nom ?? ''} · matricule ${e.matricule ?? ''} · scolarité ${fr(Math.round(Number(e.frais_mensuel)))} MRU / mois`}
        avis={
          state.password ? (
            <div className="alert alert-info" style={{ margin: '0 0 1rem' }}>
              Compte parent créé. Identifiant (téléphone) : <strong>{state.guardianPhone ?? e.telephone_parent ?? ''}</strong> — mot de passe initial :{' '}
              <strong>{state.password}</strong>. Communiquez-le au parent ; il devra le changer à la première connexion.
            </div>
          ) : null
        }
        lienTerminer="/students/new"
        libelleTerminer="Inscrire un autre"
      />
    );
  }

  return (
    <form action={action} className="form-card">
      <input type="hidden" name="academicYearId" value={academicYearId} />
      <input type="hidden" name="mode_parent" value={family} />

      <h3 style={{ marginTop: 0 }}>Informations de l&apos;étudiant</h3>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
        <div className="form-group"><label>Prénom *</label><input type="text" name="prenom" required /></div>
        <div className="form-group"><label>Nom *</label><input type="text" name="nom" required /></div>
        {/* Facultatifs (décision du propriétaire, 30/09/2026) ; uniques quand on les donne. */}
        <div className="form-group"><label>RIM (facultatif, unique)</label><input type="text" name="rim" maxLength={40} /></div>
        <div className="form-group"><label>NNI (facultatif, unique)</label><input type="text" name="nni" maxLength={40} /></div>
        <div className="form-group">
          <label>Sexe</label>
          <select name="sexe" defaultValue="">
            <option value="">— Choisir —</option>
            <option value="M">Masculin</option>
            <option value="F">Féminin</option>
          </select>
        </div>
        <div className="form-group"><label>Date de naissance</label><input type="date" name="date_naissance" /></div>
        <div className="form-group"><label>Lieu de naissance</label><input type="text" name="lieu_naissance" /></div>
        <div className="form-group">
          <label>Groupe *</label>
          <select
            name="groupe_id"
            id="groupe_id"
            required
            defaultValue=""
            onChange={(e) => {
              const g = groups.find((x) => x.id === e.target.value);
              setGroupeId(e.target.value);
              if (facturation) preRemplir(g?.level_id ?? null, mode);
              else if (g?.monthly_rate) setFee(String(Number(g.monthly_rate)));
            }}
          >
            <option value="">— Choisir —</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.level_name ?? 'Sans niveau'} — {g.name} ({g.headcount}/{g.capacity})
              </option>
            ))}
          </select>
        </div>
        <div className="form-group"><label>Frais mensuel (MRU)</label><input type="number" step={0.01} name="frais_mensuel" id="frais_mensuel" value={fee} onChange={(e) => setFee(e.target.value)} /></div>
      </div>
      {facturation && (
        <ChoixFacturation
          catalogue={facturation}
          levelId={levelId}
          mode={mode}
          onMode={(m) => {
            setMode(m);
            preRemplir(levelId, m);
          }}
        />
      )}

      <hr style={{ margin: '1.5rem 0', border: 'none', borderTop: '1px solid #eee' }} />
      <h3>Correspondant (parent)</h3>
      <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: '.4rem', cursor: 'pointer' }}>
          <input type="radio" name="mode_parent_choix" value="existant" checked={family === 'existant'} onChange={() => setFamily('existant')} /> Parent existant
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: '.4rem', cursor: 'pointer' }}>
          <input type="radio" name="mode_parent_choix" value="nouveau" checked={family === 'nouveau'} onChange={() => setFamily('nouveau')} /> Nouveau parent
        </label>
      </div>

      {family === 'existant' ? (
        <div id="bloc-existant">
          <RechercheParent name="parent_id" required={false} />
        </div>
      ) : (
        <div id="bloc-nouveau">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div className="form-group"><label>Nom complet du parent *</label><input type="text" name="p_nom" /></div>
            <div className="form-group"><label>Téléphone * (identifiant de connexion)</label><input type="text" name="p_tel" /></div>
            <div className="form-group"><label>Email (optionnel)</label><input type="email" name="p_email" /></div>
            <div className="form-group"><label>Mot de passe initial * (généré — à remettre au parent)</label><MotDePasseGenere name="p_mdp" placeholder="≥ 8 car., 3 types" /></div>
          </div>
          <small style={{ color: 'var(--text-muted)' }}>Le parent pourra changer ce mot de passe lui-même après connexion.</small>
        </div>
      )}

      <div style={{ marginTop: '1.5rem' }}>
        <button className="btn btn-primary" disabled={pending}>✓ Inscrire l&apos;étudiant</button>
      </div>
    </form>
  );
}
