'use client';

import { useEffect, useState } from 'react';
import { useActionMessage } from '@/components/message-page';
import { Modale, PiedModale } from '@/components/modale';
import { expelAction } from '@/app/actions';
import type { Etudiant } from './profils';

/**
 * « ⚠ Expell » — la modale de `recherche.php`.
 *
 * ⚠ SA VERSION SUPPRIME L'ÉTUDIANT DE LA BASE ; LA NÔTRE NE LE FERA PAS.
 *
 * Son avertissement le dit lui-même : « Cet étudiant sera supprimé de la base. »
 * Ici, cela emporterait ses inscriptions, ses paiements et sa dette — c'est-à-dire
 * l'argent qu'une famille a versé et celui qu'elle doit encore. Les écritures
 * financières ne s'effacent pas (règle 7), et « cet enfant a-t-il été exclu ? »
 * est une question que l'école se verra poser : un DELETE ne sait pas y répondre.
 *
 * Ce qui compte dans son geste — que le NNI et le RIM soient BLOQUÉS, donc
 * qu'aucune réinscription ne passe — est conservé intégralement, et c'est bien
 * l'effet que son propre avertissement met en gras. La divergence est notée en
 * ADR-0041 plutôt que décidée en silence.
 */
export function ExpulserForm({ etudiant }: { etudiant: Etudiant }) {
  const [state, action, pending] = useActionMessage(expelAction);
  const [ouvert, setOuvert] = useState(false);
  // Son `$message_expell`, en tête de page ; la modale se referme.

  useEffect(() => { if (state) setOuvert(false); }, [state]);

  /*
   * ⚠ SA MODALE `#m-expell`, et son bouton « ⚠ Expell ».
   *
   * Je l'avais faite en carte dépliante sous la fiche. Sa version sort une
   * fenêtre par-dessus, et sur ce geste-là c'est le bon choix : l'avertissement
   * — NNI et RIM bloqués — doit occuper l'écran seul, pas partager la place avec
   * le relevé de notes de l'enfant qu'on est en train d'exclure.
   */
  return (
    <>
      <button
        type="button"
        className="btn btn-danger"
        style={{ width: 'auto' }}
        onClick={() => setOuvert(true)}
      >
        ⚠ Expell
      </button>

      <Modale
        ouverte={ouvert}
        onFermer={() => setOuvert(false)}
        titre={`⚠ Expulser ${etudiant.first_name} ${etudiant.last_name}`}
        largeur={500}
      >
        <form action={action}>
        <input type="hidden" name="nationalId" value={etudiant.national_id} />
        <input type="hidden" name="rim" value={etudiant.rim} />
        <input type="hidden" name="firstName" value={etudiant.first_name} />
        <input type="hidden" name="lastName" value={etudiant.last_name} />

        <div className="alert alert-warning" style={{ fontSize: '.88rem' }}>
          ⚠ <strong>Action grave.</strong>
          <br />
          Son <strong>NNI ({etudiant.national_id || '—'})</strong> et son{' '}
          <strong>RIM ({etudiant.rim || '—'})</strong> seront <strong>bloqués</strong> :
          impossible de l’inscrire à nouveau dans l’établissement.
          <br />
          {/* La phrase qui remplace « sera supprimé de la base » — et qui dit la
              vérité sur ce qui se passe réellement. */}
          Son dossier, lui, est conservé : les paiements déjà faits et la dette
          restante demeurent lisibles. Un blocage peut être levé depuis le
          registre des exclusions, et la levée y reste inscrite.
        </div>

        <div className="form-group">
          <label htmlFor="motif-expulsion">Motif (facultatif)</label>
          <textarea
            id="motif-expulsion"
            name="reason"
            rows={3}
            maxLength={255}
            placeholder="Ex : Comportement répété, violence…"
          />
        </div>

        {/* Son pied de modale : « Annuler » puis l'action. */}
        <PiedModale onAnnuler={() => setOuvert(false)}>
          {/* Son `onclick="return confirm('Confirmer l'expulsion définitive ?')"`. */}
          <button
            className="btn btn-danger"
            disabled={pending}
            onClick={(e) => { if (!window.confirm("Confirmer l'expulsion définitive ?")) e.preventDefault(); }}
          >
            ⚠ Confirmer l&apos;expulsion
          </button>
        </PiedModale>
        </form>
      </Modale>
    </>
  );
}
