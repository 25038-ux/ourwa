import { CanActivate, Injectable, NotFoundException } from '@nestjs/common';
import { deploiementDepuisEnv } from '@elourwa/shared/brand';

/**
 * LA CONSOLE DE LA PLATEFORME N'EXISTE PAS EN ÉCOLE UNIQUE.
 *
 * Une installation qui ne sert qu'une école (`SINGLE_SCHOOL_SLUG`, ou
 * `PLATFORM_CONSOLE=off`) n'a ni branches à créer, ni administrateurs de
 * plateforme, ni cumul des caisses : ses routes `/platform/*` répondent 404,
 * comme si elles n'avaient jamais été écrites. Un 404 plutôt qu'un 403 : rien
 * n'est « interdit », il n'y a rien.
 *
 * Posé sur les deux contrôleurs `/platform` (la console et le registre des
 * écoles). Les gardes globales (limite, authentification) passent avant ; une
 * requête anonyme reçoit donc 401 puis, connectée, 404.
 */
@Injectable()
export class ConsoleGuard implements CanActivate {
  canActivate(): boolean {
    if (!deploiementDepuisEnv(process.env).console) {
      throw new NotFoundException('Cette installation n’a pas de console de plateforme.');
    }
    return true;
  }
}
