import { renderBulletinOfficiel, type BulletinCard } from '@elourwa/shared/bulletin-html';

export type { BulletinCard };

/**
 * LE BULLETIN OFFICIEL DU SITE = LE BULLETIN DE L'APPLICATION. Le document est
 * produit par `renderBulletinOfficiel()` (`@elourwa/shared`), le même code que
 * l'API sert aux familles ; ce composant ne fait que l'insérer. Les données
 * sont échappées là-bas (`esc()`), le balisage n'est jamais construit ici.
 * Décision du propriétaire (2026-09-19) — ADR-0067.
 */
export function BulletinOfficiel({ card, schoolName }: { card: BulletinCard; schoolName: string }) {
  // eslint-disable-next-line react/no-danger -- rendu partagé, échappé à la source
  return <div dangerouslySetInnerHTML={{ __html: renderBulletinOfficiel(card, schoolName) }} />;
}
