import { z } from 'zod';
import { MODES_ETUDE, SERVICE_CODES, SERVICES_OPTIONNELS, type ServiceOptionnel } from '@elourwa/shared';

/**
 * Les champs « services » (ADR-0073) des formulaires d'inscription, de
 * réinscription et de la page « Frais » — un seul endroit, pour que les trois
 * contrôleurs qui les reçoivent (admissions, inscriptions, facturation)
 * refusent la même chose avec les mêmes mots.
 */

/** '8h-14h' | '8h-17h'. Obligatoire dans une école « services » : c'est le service qui le dit. */
export const studyModeSchema = z.enum(MODES_ETUDE);

/**
 * Un service qu'une famille coche. ⚠ `inscription` n'en est pas : elle est
 * ajoutée d'office à chaque (ré)inscription, et la cocher la créerait deux fois
 * dans l'esprit de la secrétaire.
 */
export const serviceOptionnelSchema = z
  .enum(SERVICE_CODES)
  .refine((code): code is ServiceOptionnel => code !== 'inscription', {
    message: "« inscription » est ajoutée d'office à chaque (ré)inscription : ne la cochez pas.",
  });

export const servicesOptionnelsSchema = z.array(serviceOptionnelSchema).max(SERVICES_OPTIONNELS.length);

/**
 * Un montant de la page « Frais », en CHAÎNE (règle 6). Le format est vérifié
 * par le service, qui dit lequel des champs est faux ; vide = « non défini ».
 */
export const montantOuVideSchema = z.string().max(20);
