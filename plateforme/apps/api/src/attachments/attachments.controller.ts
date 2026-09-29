import {
  BadRequestException,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import { AttachmentsService } from './attachments.service.js';
import { MAX_BYTES, UploadRejected } from './storage.js';
import { RequirePermission, type AuthenticatedRequest } from '../auth/permissions.guard.js';
import { runInTenant } from '../tenant/tenant.context.js';

const uuid = z.string().uuid();

@Controller('attachments')
export class AttachmentsController {
  constructor(
    @Inject(AttachmentsService) private readonly attachments: AttachmentsService,
  ) {}

  /**
   * Whether every attachment row still has its file.
   *
   * Behind `journal.consulter` because it is an operational check, not a
   * teaching one — the question is asked after a restore, by whoever did it.
   */
  @Get('integrity')
  @RequirePermission('journal.consulter')
  integrity() {
    return this.attachments.integrity();
  }

  @Get('homework/:homeworkId')
  @RequirePermission('exercices.envoyer', 'notes.consulter')
  list(@Param('homeworkId') homeworkId: string) {
    return this.attachments.forHomework(uuid.parse(homeworkId));
  }

  @Post('homework/:homeworkId')
  @RequirePermission('exercices.envoyer')
  async upload(@Param('homeworkId') homeworkId: string, @Req() request: AuthenticatedRequest) {
    const anyRequest = request as unknown as {
      isMultipart?: () => boolean;
      file?: (opts?: unknown) => Promise<{
        filename: string;
        toBuffer: () => Promise<Buffer>;
      } | undefined>;
    };
    if (!anyRequest.isMultipart?.()) {
      throw new BadRequestException('Envoyez le fichier en multipart/form-data.');
    }

    const part = await anyRequest.file?.({ limits: { fileSize: MAX_BYTES } });
    if (!part) throw new BadRequestException('Aucun fichier reçu.');

    let buffer: Buffer;
    try {
      buffer = await part.toBuffer();
    } catch {
      // @fastify/multipart throws once the declared limit is passed, rather than
      // buffering the whole thing first — which is the point of the limit.
      throw new BadRequestException(
        `Fichier trop volumineux (maximum ${MAX_BYTES / 1024 / 1024} Mo).`,
      );
    }

    try {
      return await this.attachments.attach(
        uuid.parse(homeworkId),
        { buffer, filename: part.filename },
        request.auth!.userId,
      );
    } catch (error) {
      if (error instanceof UploadRejected) throw new BadRequestException(error.message);
      throw error;
    }
  }

  /**
   * Hand the file over, having checked who is asking.
   *
   * `Content-Disposition: attachment` and `X-Content-Type-Options: nosniff`
   * together stop a stored file being rendered as a document in the school's own
   * origin — a PDF or an SVG-shaped upload should download, never execute.
   */
  @Get(':id')
  async download(
    @Param('id') id: string,
    @Req() request: AuthenticatedRequest,
    @Res() reply: FastifyReply,
  ) {
    const attachmentId = uuid.parse(id);
    // Une session de famille n'a pas d'école : la pièce jointe est cherchée
    // dans chacune des siennes, sous le contexte de chacune. Introuvable
    // partout : « Pièce jointe introuvable. », comme pour une école.
    const file = request.auth!.ecolesFamille
      ? await (async () => {
          let derniere: unknown = null;
          for (const ecole of request.auth!.ecolesFamille!) {
            try {
              return await runInTenant({ schoolId: ecole.id, slug: ecole.slug }, () =>
                this.attachments.download(attachmentId, request.auth!.userId, request.auth!.permissions),
              );
            } catch (e) {
              if (e instanceof NotFoundException) { derniere = e; continue; }
              throw e;
            }
          }
          throw derniere ?? new NotFoundException('Pièce jointe introuvable.');
        })()
      : await this.attachments.download(attachmentId, request.auth!.userId, request.auth!.permissions);

    return reply
      .header('Content-Type', file.mime)
      .header('X-Content-Type-Options', 'nosniff')
      .header(
        'Content-Disposition',
        `attachment; filename*=UTF-8''${encodeURIComponent(file.displayName)}`,
      )
      // Private: it is one family's document, and a shared cache must not keep it.
      .header('Cache-Control', 'private, max-age=300')
      .send(file.buffer);
  }
}
