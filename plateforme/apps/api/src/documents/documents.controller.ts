import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import { DocumentsService } from './documents.service.js';
import { MAX_BYTES } from '../attachments/storage.js';
import { RequirePermission, type AuthenticatedRequest } from '../auth/permissions.guard.js';

const uuid = z.string().uuid();

/**
 * LES DOCUMENTS SIGNÉS, CÔTÉ ÉCOLE — la page « Documents » du site (ADR-0080).
 * `documents.gerer` : la direction et le secrétariat. La famille, elle, lit
 * par `GET /parent/documents` — sans jamais pouvoir écrire.
 */
@Controller('documents')
export class DocumentsController {
  constructor(@Inject(DocumentsService) private readonly documents: DocumentsService) {}

  @Get('familles')
  @RequirePermission('documents.gerer')
  rechercher(@Query('q') q = '') {
    return this.documents.rechercherFamilles(String(q).slice(0, 100));
  }

  @Get('familles/:guardianId')
  @RequirePermission('documents.gerer')
  famille(@Param('guardianId') guardianId: string, @Query('academicYearId') yearId?: string) {
    return this.documents.famille(uuid.parse(guardianId), yearId ? uuid.parse(yearId) : null);
  }

  /** Déposer, ou remplacer, le document d'une pièce (multipart, un fichier). */
  @Post('eleves/:studentId/:piece')
  @RequirePermission('documents.gerer')
  async deposer(
    @Param('studentId') studentId: string,
    @Param('piece') piece: string,
    @Query('academicYearId') yearId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    const anyRequest = request as unknown as {
      isMultipart?: () => boolean;
      file?: (opts?: unknown) => Promise<{ filename: string; toBuffer: () => Promise<Buffer> } | undefined>;
    };
    if (!anyRequest.isMultipart?.()) throw new BadRequestException('Envoyez le fichier en multipart/form-data.');
    const part = await anyRequest.file?.({ limits: { fileSize: MAX_BYTES } });
    if (!part) throw new BadRequestException('Aucun fichier reçu.');
    let buffer: Buffer;
    try {
      buffer = await part.toBuffer();
    } catch {
      throw new BadRequestException(`Fichier trop volumineux (maximum ${MAX_BYTES / 1024 / 1024} Mo).`);
    }
    return this.documents.deposer(
      uuid.parse(studentId),
      uuid.parse(yearId),
      piece,
      { buffer, filename: part.filename },
      request.auth!.userId,
    );
  }

  @Delete(':id')
  @RequirePermission('documents.gerer')
  supprimer(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    return this.documents.supprimer(uuid.parse(id), request.auth!.userId);
  }

  @Get(':id/fichier')
  @RequirePermission('documents.gerer')
  async fichier(@Param('id') id: string, @Query('voir') voir: string | undefined, @Res() reply: FastifyReply) {
    const f = await this.documents.fichier(uuid.parse(id));
    return envoyer(reply, f, voir === '1');
  }
}

/**
 * Le fichier, avec les en-têtes des pièces jointes : `nosniff`, cache privé.
 * `inline` seulement pour « Voir » (un PDF ou une image, types fermés par la
 * base) ; sinon téléchargé.
 */
export function envoyer(
  reply: FastifyReply,
  f: { buffer: Buffer; mime: string; displayName: string },
  enLigne: boolean,
) {
  return reply
    .header('Content-Type', f.mime)
    .header('X-Content-Type-Options', 'nosniff')
    .header(
      'Content-Disposition',
      `${enLigne ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(f.displayName)}`,
    )
    .header('Cache-Control', 'private, no-store')
    .send(f.buffer);
}
