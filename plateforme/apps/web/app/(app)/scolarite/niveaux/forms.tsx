'use client';


import { createGroupAction, createLevelAction, createLevelServicesAction } from '@/app/actions';
import { useActionMessage } from '@/components/message-page';
import { libelleMode } from '@elourwa/shared/facturation';

/** Les trois tarifs d'un niveau d'école « services » — mêmes noms que `PATCH /levels/:id/tarifs`. */
const COLONNES_TARIFS = [
  { champ: 'tarif8h14', titre: `Tarif ${libelleMode('8h-14h')}` },
  { champ: 'tarif8h17', titre: `Tarif ${libelleMode('8h-17h')}` },
  { champ: 'fraisInscription', titre: "Frais d'inscription" },
] as const;

type Result = { ok?: string; error?: string } | null;

/**
 * CRÉER UN NIVEAU — `gerer_niveaux.php`, `creer_niveau` : « Nom du niveau * »
 * (20 caractères, « Ex: 6ème »), « Tarif mensuel (MRU) * » (pas de 100,
 * 15000), « Seuil d'admission (/20) * » (pas de 0,25, 10, et sa phrase
 * d'aide), et la case « Niveau fondamental » avec sa définition. Le cycle
 * n'est pas demandé : un niveau créé ici est « autre », comme chez lui.
 */
export function LevelForm({ services = false }: { services?: boolean }) {
  // École « services » (Jinan) : les trois tarifs à la place du tarif mensuel,
  // et l'action qui crée le niveau puis pose ses tarifs. Le choix ne change
  // jamais pendant la vie du formulaire.
  const [state, action, pending] = useActionMessage(services ? createLevelServicesAction : createLevelAction);


  return (
    <form action={action}>
      <div className="form-row">
        <div className="form-group">
          <label htmlFor="nom_niveau">Nom du niveau *</label>
          <input type="text" id="nom_niveau" name="nom_niveau" placeholder="Ex: 6ème" required maxLength={20} />
        </div>
        {services ? (
          COLONNES_TARIFS.map((c) => (
            <div className="form-group" key={c.champ}>
              <label htmlFor={`niveau_${c.champ}`}>{c.titre} (MRU)</label>
              <input type="number" id={`niveau_${c.champ}`} name={c.champ} min={0} step="0.01" placeholder="non défini" />
            </div>
          ))
        ) : (
          <div className="form-group">
            <label htmlFor="tarif_mensuel">Tarif mensuel (MRU) *</label>
            <input type="number" id="tarif_mensuel" name="tarif_mensuel" min={0} step={100} defaultValue={15000} required />
          </div>
        )}
        <div>
          <label htmlFor="seuil_eliminatoire">Seuil d&apos;admission (/20) *</label>
          <input type="number" id="seuil_eliminatoire" name="seuil_eliminatoire" min={0} max={20} step={0.25} defaultValue={10} required />
          <small className="text-muted">En dessous : « Ajourné ». Au niveau ou au-dessus : « Admis ».</small>
        </div>
        <div className="form-group" style={{ display: 'flex', alignItems: 'flex-end' }}>
          <label style={{ display: 'inline-flex', gap: '.45rem', alignItems: 'center', cursor: 'pointer' }}>
            <input type="checkbox" name="fondamental" value="1" />
            <span><strong>Niveau fondamental</strong> — chaque matière est notée sur son propre barème (ex. /50, /30) ; moyenne matière = (moy. devoirs + examen) ÷ 2 ; total du trimestre = somme des moyennes / somme des barèmes.</span>
          </label>
        </div>
      </div>
      <button type="submit" className="btn btn-primary" style={{ width: 'auto' }} disabled={pending}>Créer le Niveau</button>
    </form>
  );
}

/**
 * CRÉER UN GROUPE DANS « … » — son `creer_groupe` : `niveau_id` caché,
 * « Nom du groupe * » (« Ex: 6ème A »), « Capacité * » (1 à 100, 30).
 */
export function GroupInLevelForm({ level }: { level: { id: string; name: string } }) {
  const [state, action, pending] = useActionMessage(createGroupAction);


  return (
    <form action={action}>
      <input type="hidden" name="levelId" value={level.id} />
      <div className="form-row">
        <div className="form-group">
          <label htmlFor="nom_groupe">Nom du groupe *</label>
          <input type="text" id="nom_groupe" name="name" placeholder={`Ex: ${level.name} A`} required maxLength={50} />
        </div>
        <div className="form-group">
          <label htmlFor="capacite">Capacité *</label>
          <input type="number" id="capacite" name="capacity" min={1} max={100} defaultValue={30} required />
        </div>
      </div>
      <button type="submit" className="btn btn-primary" style={{ width: 'auto' }} disabled={pending}>Créer le groupe</button>
    </form>
  );
}
