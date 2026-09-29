import type { SessionUser } from '@/lib/session';
import { estEcoleServices } from '@/lib/tenant';

/**
 * LE BOUTON « FRAIS » — l'entrée de la page des tarifs et des prix (Jinan,
 * spécification §9), posé dans l'en-tête de « Gérer les niveaux » et de la
 * caisse (`<PageHeader right={…}>`).
 *
 * Rien du tout — pas même un élément vide — pour une école « famille » ou pour
 * qui n'est pas de la direction (super_admin, admin) : l'en-tête d'El Ourwa,
 * d'El Mourad, de Nour… reste exactement le sien.
 */
export async function BoutonFrais({ user }: { user: SessionUser }) {
  const direction = user.roles.includes('super_admin') || user.roles.includes('admin');
  if (!direction || !(await estEcoleServices())) return null;
  return (
    <a href="/frais" className="btn btn-sm btn-secondary">
      Frais
    </a>
  );
}
