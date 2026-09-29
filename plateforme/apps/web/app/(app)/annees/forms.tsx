'use client';

import { useId } from 'react';
import { useActionMessage } from '@/components/message-page';
import {
  activateYearAction,
  closeYearAction,
  createYearAction,
  setYearPeriodAction,
} from '@/app/actions';

/** `MOIS_FR` — ses douze libellés, dans son ordre. */
export const MOIS = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
];

/**
 * NOUVELLE ANNÉE SCOLAIRE — trois champs sur une ligne, et son bouton
 * « Créer ».
 *
 * ⚠ SES DEUX SÉLECTEURS DE MOIS, pas une grille de douze cases. Une année
 * scolaire est une PÉRIODE — « octobre → juin » — et les mois facturables se
 * déduisent d'elle. Nous demandions de cocher les douze mois un par un, ce qui
 * pose la question à l'envers et laisse cocher décembre sans octobre.
 * Ses valeurs par défaut : Octobre et Juin.
 */
export function NouvelleAnnee() {
  const [, action, pending] = useActionMessage(createYearAction);
  const id = useId();
  const now = new Date().getFullYear();

  return (
    <form
      action={action}
      style={{ display: 'flex', gap: '.8rem', alignItems: 'flex-end', flexWrap: 'wrap' }}
    >
      <div>
        <label htmlFor={`${id}-debut`}>Année de début *</label>
        <input
          type="number"
          id={`${id}-debut`}
          name="startYear"
          min={2000}
          max={2100}
          defaultValue={now}
        />
      </div>
      <div>
        <label htmlFor={`${id}-mois-debut`}>Premier mois *</label>
        <select id={`${id}-mois-debut`} name="startMonth" defaultValue={10}>
          {MOIS.map((m, i) => (
            <option key={m} value={i + 1}>
              {m}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor={`${id}-mois-fin`}>Dernier mois *</label>
        <select id={`${id}-mois-fin`} name="endMonth" defaultValue={6}>
          {MOIS.map((m, i) => (
            <option key={m} value={i + 1}>
              {m}
            </option>
          ))}
        </select>
      </div>
      <button type="submit" className="btn btn-primary" disabled={pending}>
        {pending ? 'Création…' : 'Créer'}
      </button>
    </form>
  );
}

/** La période d'une année existante — ses deux sélecteurs et son « ✓ ». */
export function PeriodeForm({
  anneeId,
  startMonth,
  endMonth,
  figee,
}: {
  anneeId: string;
  startMonth: number;
  endMonth: number;
  figee: boolean;
}) {
  const [, action, pending] = useActionMessage(setYearPeriodAction);
  // Ses deux sélecteurs sont rendus sur toutes les lignes ; sur une année
  // clôturée, c'est le serveur qui refuse (`refus_annee_close_id`).
  void figee;

  return (
    /**
     * ⚠ `key` SUR LE FORMULAIRE, ET CE N'EST PAS COSMÉTIQUE. Les deux sélecteurs
     * sont non contrôlés : après un enregistrement, le serveur renvoie bien les
     * nouveaux mois, mais React garde la valeur que l'utilisateur voit à
     * l'écran — donc la ligne affichait « Période enregistrée » à côté des
     * ANCIENS mois, et l'opérateur croyait que rien n'avait été pris.
     *
     * La clé change avec les valeurs venues du serveur, ce qui remonte le
     * formulaire et le remet d'accord avec la base. Chez elle la page entière
     * se recharge et la question ne se pose pas.
     */
    <form
      key={`${startMonth}-${endMonth}`}
      action={action}
      style={{ display: 'flex', gap: '.35rem', alignItems: 'center' }}
    >
      <input type="hidden" name="anneeId" value={anneeId} />
      <select name="startMonth" defaultValue={startMonth} style={{ padding: '.25rem' }}>
        {MOIS.map((m, i) => (
          <option key={m} value={i + 1}>
            {m}
          </option>
        ))}
      </select>
      <span>→</span>
      <select name="endMonth" defaultValue={endMonth} style={{ padding: '.25rem' }}>
        {MOIS.map((m, i) => (
          <option key={m} value={i + 1}>
            {m}
          </option>
        ))}
      </select>
      <button
        type="submit"
        className="btn btn-sm btn-secondary"
        style={{ padding: '.25rem .5rem' }}
        disabled={pending}
      >
        ✓
      </button>
    </form>
  );
}

/** RENDRE ACTIVE, derrière sa confirmation « Rendre <année> active ? ». */
export function ActiverForm({
  anneeId,
  libelle,
  figee,
  cloturera,
}: {
  anneeId: string;
  libelle: string;
  figee: boolean;
  /** L'année en cours que cette activation clôturera (année ultérieure), avec ses inscrits. */
  cloturera?: { libelle: string; inscrits: number } | null;
}) {
  // ⚠ AU RETOUR DE L'ACTION, pas dans un effet : après « Rendre active » la
  // ligne se re-rend sans ce bouton (l'année active porte « Clôturer »), le
  // composant qui tenait le message disparaît, et « Année active mise à
  // jour. » ne s'affichait jamais.
  const [, action, pending] = useActionMessage(activateYearAction);
  // Rendu aussi sur une année clôturée : son serveur refuse, et le dit.
  void figee;

  return (
    <form
      action={action}
      onSubmit={(e) => {
        // Décision du propriétaire (18/09) : activer l'année suivante clôture
        // l'année en cours — la confirmation le dit, avec le nombre d'inscrits
        // qui seront archivés. Revenir sur une année antérieure ne clôture rien.
        const question = cloturera
          ? `Rendre ${libelle} active clôturera ${cloturera.libelle} : ses ${cloturera.inscrits} inscription(s) seront archivées et ne se rouvriront plus. Continuer ?`
          : `Rendre ${libelle} active ?`;
        if (!confirm(question)) e.preventDefault();
      }}
    >
      <input type="hidden" name="anneeId" value={anneeId} />
      <button type="submit" className="btn btn-sm btn-secondary" disabled={pending}>
        Rendre active
      </button>
    </form>
  );
}

/**
 * CLÔTURER — et sa garde : il faut taper CLOTURER dans la case.
 *
 * ⚠ SON PLACEHOLDER EST LE MOT À TAPER. Une clôture archive toutes les
 * inscriptions et vide les classes ; une confirmation qu'on peut donner par
 * réflexe n'en est pas une.
 */
export function CloturerForm({ anneeId, libelle }: { anneeId: string; libelle: string }) {
  // ⚠ AU RETOUR DE L'ACTION : la clôture remplace cette ligne (« Clôturée »,
  // bouton « Rendre active ») — le formulaire est démonté avant que son effet
  // ait publié, et la page restait muette : « Clôturer ne marche pas ».
  const [, action, pending] = useActionMessage(closeYearAction);

  return (
    <form action={action} style={{ display: 'flex', gap: '.3rem', alignItems: 'center' }}>
      <input type="hidden" name="anneeId" value={anneeId} />
      <input type="hidden" name="libelle" value={libelle} />
      {/* ⚠ Pas de `required` : React ne lance pas l'action quand un champ requis est
          vide, et RIEN ne s'affiche — « Clôturer ne marche pas ». Le refus vient du
          serveur, en tête de page, comme chez lui. */}
      <input
        type="text"
        name="confirmation"
        placeholder="CLOTURER"
        autoComplete="off"
        style={{
          width: 110,
          padding: '.25rem .4rem',
          border: '2px solid var(--border)',
          borderRadius: 6,
          fontSize: '.8rem',
        }}
      />
      <button type="submit" className="btn btn-sm" style={{ background: '#B45309', color: '#fff' }} disabled={pending}>
        Clôturer
      </button>
    </form>
  );
}
