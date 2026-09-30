'use client';

import { useState } from 'react';
import { modifierCorrespondantAction, modifierEleveAction } from '@/app/actions';
import { useActionMessage } from '@/components/message-page';
import { Modale, PiedModale } from '@/components/modale';
import { TelephonesFamille, type TelephoneFamille } from '@/components/telephones-famille';

export interface FicheEleve {
  id: string;
  first_name: string;
  last_name: string;
  sex: string | null;
  date_of_birth: string | null;
  place_of_birth: string | null;
  national_id: string | null;
  rim: string | null;
  matricule: string | null;
}

/**
 * LE DOSSIER DE LA FAMILLE SE CORRIGE SUR PLACE — décision du propriétaire
 * (2026-09-20) : « we should be able to edit parent and children information
 * through family document ». Le correspondant (nom, téléphone, e-mail) et la
 * fiche de chaque enfant (prénom, nom, sexe, naissance, NNI, RIM), depuis la
 * page de la famille, sans repasser par l'admission. Le groupe et le tarif
 * gardent leurs écrans ; le rattachement d'un enfant à une autre famille n'est
 * pas une correction et ne se fait pas ici.
 */
export function DossierFamille({
  guardian,
  eleves,
  peutModifier,
  telephones,
}: {
  guardian: { id: string; full_name: string; phone: string | null; email: string | null };
  eleves: FicheEleve[];
  peutModifier: boolean;
  /** Les numéros supplémentaires de la famille (0041). */
  telephones?: TelephoneFamille[];
}) {
  const [ouvert, setOuvert] = useState<'correspondant' | string | null>(null);
  const [, actCorrespondant, pendingC] = useActionMessage(modifierCorrespondantAction);
  const [, actEleve, pendingE] = useActionMessage(modifierEleveAction);
  if (!peutModifier) return null;
  const eleve = eleves.find((e) => e.id === ouvert) ?? null;

  return (
    <div className="no-print" style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', marginTop: '.6rem' }}>
      <button type="button" className="btn btn-sm btn-secondary" onClick={() => setOuvert('correspondant')}>
        ✎ Modifier le correspondant
      </button>
      <button type="button" className="btn btn-sm btn-secondary" onClick={() => setOuvert('telephones')}>
        ☎ Numéros de la famille{(telephones ?? []).length > 0 ? ` (${(telephones ?? []).length + 1})` : ''}
      </button>
      {eleves.map((e) => (
        <button key={e.id} type="button" className="btn btn-sm btn-secondary" onClick={() => setOuvert(e.id)}>
          ✎ Fiche de {e.first_name}
        </button>
      ))}

      <Modale titre="Modifier le correspondant" largeur={520} ouverte={ouvert === 'correspondant'} onFermer={() => setOuvert(null)}>
        <form action={actCorrespondant} onSubmit={() => setTimeout(() => setOuvert(null), 0)}>
          <input type="hidden" name="userId" value={guardian.id} />
          <div className="form-group">
            <label htmlFor="df-nom">Nom complet *</label>
            <input id="df-nom" type="text" name="nom_complet" defaultValue={guardian.full_name} maxLength={120} required />
          </div>
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="df-tel">Téléphone (identifiant de connexion)</label>
              <input id="df-tel" type="tel" name="telephone" defaultValue={guardian.phone ?? ''} maxLength={40} placeholder="8 chiffres, commence par 2, 3 ou 4" />
            </div>
            <div className="form-group">
              <label htmlFor="df-email">E-mail</label>
              <input id="df-email" type="email" name="email" defaultValue={guardian.email ?? ''} maxLength={160} />
            </div>
          </div>
          <p className="text-muted" style={{ fontSize: '.82rem' }}>
            Le téléphone est l'identifiant avec lequel la famille se connecte à l'application : un numéro mauritanien,
            unique. Vider les deux champs est refusé.
          </p>
          <PiedModale onAnnuler={() => setOuvert(null)}>
            <button type="submit" className="btn btn-primary" disabled={pendingC}>Enregistrer</button>
          </PiedModale>
        </form>
      </Modale>

      <Modale titre="Numéros de téléphone de la famille" largeur={560} ouverte={ouvert === 'telephones'} onFermer={() => setOuvert(null)}>
        <TelephonesFamille parentId={guardian.id} principal={guardian.phone} telephones={telephones ?? []} />
        <div className="modal-footer"><button type="button" className="btn btn-secondary" onClick={() => setOuvert(null)}>Fermer</button></div>
      </Modale>

      <Modale titre={eleve ? `Fiche de ${eleve.first_name} ${eleve.last_name}` : ''} largeur={560} ouverte={eleve !== null} onFermer={() => setOuvert(null)}>
        {eleve && (
          <form action={actEleve} key={eleve.id} onSubmit={() => setTimeout(() => setOuvert(null), 0)}>
            <input type="hidden" name="studentId" value={eleve.id} />
            <div className="form-row">
              <div className="form-group"><label htmlFor="df-prenom">Prénom *</label><input id="df-prenom" type="text" name="prenom" defaultValue={eleve.first_name} required maxLength={80} /></div>
              <div className="form-group"><label htmlFor="df-nomel">Nom *</label><input id="df-nomel" type="text" name="nom" defaultValue={eleve.last_name} required maxLength={80} /></div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label htmlFor="df-sexe">Sexe</label>
                <select id="df-sexe" name="sexe" defaultValue={eleve.sex ?? ''}>
                  <option value="">—</option><option value="M">Masculin</option><option value="F">Féminin</option>
                </select>
              </div>
              <div className="form-group"><label htmlFor="df-ddn">Date de naissance</label><input id="df-ddn" type="date" name="date_naissance" defaultValue={eleve.date_of_birth ?? ''} /></div>
              <div className="form-group"><label htmlFor="df-lieu">Lieu de naissance</label><input id="df-lieu" type="text" name="lieu_naissance" defaultValue={eleve.place_of_birth ?? ''} maxLength={120} /></div>
            </div>
            <div className="form-row">
              <div className="form-group"><label htmlFor="df-nni">NNI</label><input id="df-nni" type="text" name="nni" defaultValue={eleve.national_id ?? ''} maxLength={40} /></div>
              <div className="form-group"><label htmlFor="df-rim">RIM</label><input id="df-rim" type="text" name="rim" defaultValue={eleve.rim ?? ''} maxLength={40} /></div>
            </div>
            <p className="text-muted" style={{ fontSize: '.82rem' }}>
              Matricule : <code>{eleve.matricule ?? '—'}</code> (attribué à l'inscription, ne se modifie pas). Le groupe et le tarif se changent
              depuis leurs écrans.
            </p>
            <PiedModale onAnnuler={() => setOuvert(null)}>
              <button type="submit" className="btn btn-primary" disabled={pendingE}>Enregistrer</button>
            </PiedModale>
          </form>
        )}
      </Modale>
    </div>
  );
}
