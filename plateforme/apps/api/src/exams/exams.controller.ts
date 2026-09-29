import { Body, Controller, Get, Inject, Param, Post, Query, Req } from '@nestjs/common';
import { z } from 'zod';
import { ExamAccessService } from './exam-access.service.js';
import { AcademicYearService } from '../academic/academic-year.service.js';
import { RequirePermission, type AuthenticatedRequest } from '../auth/permissions.guard.js';

const uuid = z.string().uuid();
const term = z.coerce.number().int().min(1).max(3);

/**
 * Exam-result access — El Ourwa's `derogations.php`.
 *
 * ⚠ `derogations.gerer` is DIRECTION ONLY. When a debt is settled the door opens
 * by itself, so the accountant needs no power of derogation to do their job. An
 * exception to the school's recovery policy is a decision of the direction, not
 * of the till.
 */
@Controller('exam-access')
@RequirePermission('derogations.gerer')
export class ExamAccessController {
  constructor(
    @Inject(ExamAccessService) private readonly exams: ExamAccessService,
    @Inject(AcademicYearService) private readonly years: AcademicYearService,
  ) {}

  private async yearId(given?: string): Promise<string> {
    if (given) return uuid.parse(given);
    const year = await this.years.defaultView();
    if (!year) throw new Error('No academic year');
    return year.id;
  }

  @Get()
  async overview(@Query('academicYearId') yearId?: string) {
    return this.exams.overview(await this.yearId(yearId));
  }

  @Get('derogations')
  async list(@Query('academicYearId') yearId?: string) {
    return this.exams.derogations(await this.yearId(yearId));
  }

  @Post('derogations')
  async grant(@Body() raw: unknown, @Req() request: AuthenticatedRequest) {
    const body = z
      .object({
        guardianId: uuid,
        studentId: uuid.optional(),
        academicYearId: uuid.optional(),
        term: term.optional(),
        reason: z.string().trim().min(1).max(190),
        expiresAt: z.string().datetime().optional(),
      })
      .parse(raw ?? {});
    return this.exams.grantDerogation(
      { ...body, academicYearId: await this.yearId(body.academicYearId) },
      request.auth!.userId,
    );
  }

  @Post('derogations/:id/revoke')
  revoke(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    return this.exams.revokeDerogation(uuid.parse(id), request.auth!.userId);
  }

  /** Close a term the family had earned. Outranks a settled debt. */
  @Post('terms/close')
  async closeTerm(@Body() raw: unknown, @Req() request: AuthenticatedRequest) {
    const body = z
      .object({
        guardianId: uuid,
        academicYearId: uuid.optional(),
        term,
        reason: z.string().trim().min(1).max(190),
      })
      .parse(raw ?? {});
    return this.exams.closeTerm(
      { ...body, academicYearId: await this.yearId(body.academicYearId) },
      request.auth!.userId,
    );
  }

  @Post('terms/reopen')
  async reopenTerm(@Body() raw: unknown, @Req() request: AuthenticatedRequest) {
    const body = z
      .object({ guardianId: uuid, academicYearId: uuid.optional(), term })
      .parse(raw ?? {});
    return this.exams.reopenTerm(
      { ...body, academicYearId: await this.yearId(body.academicYearId) },
      request.auth!.userId,
    );
  }
}
