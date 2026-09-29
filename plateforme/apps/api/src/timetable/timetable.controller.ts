import { Body, Controller, Delete, Get, Inject, Param, Post, Query, Req } from '@nestjs/common';
import { z } from 'zod';
import { TimetableService } from './timetable.service.js';
import { RequirePermission, type AuthenticatedRequest } from '../auth/permissions.guard.js';

const uuid = z.string().uuid();
const day = z.coerce.number().int().min(1).max(7);
const slot = z.coerce.number().int().min(1).max(6);

@Controller('timetable')
export class TimetableController {
  constructor(@Inject(TimetableService) private readonly timetable: TimetableService) {}

  /** A class group's week. Readable by anyone who can see the class. */
  @Get('group/:groupId')
  @RequirePermission('scolarite.groupes', 'notes.consulter', 'absences.consulter')
  forGroup(@Param('groupId') groupId: string) {
    return this.timetable.forGroup(uuid.parse(groupId));
  }

  /** Les enseignements courants du groupe — son `SQL_ENS_COURANTS`. */
  @Get('group/:groupId/teachings')
  @RequirePermission('scolarite.groupes', 'notes.consulter', 'absences.consulter')
  enseignements(@Param('groupId') groupId: string) {
    return this.timetable.enseignementsCourants(uuid.parse(groupId));
  }

  /** A teacher's own week. */
  @Get('teacher/:teacherId')
  @RequirePermission('scolarite.groupes', 'notes.consulter', 'absences.consulter')
  forTeacher(@Param('teacherId') teacherId: string) {
    return this.timetable.forTeacher(uuid.parse(teacherId));
  }

  @Post()
  @RequirePermission('scolarite.groupes')
  assign(@Body() raw: unknown, @Req() request: AuthenticatedRequest) {
    const body = z
      .object({ groupId: uuid, teachingId: uuid, dayOfWeek: day, slot })
      .parse(raw ?? {});
    return this.timetable.assign(body, request.auth!.userId);
  }

  /** Valider et publier — son `valider`, derrière la permission qui remplit la grille. */
  @Post('publish')
  @RequirePermission('scolarite.groupes')
  publish(@Body() raw: unknown, @Req() request: AuthenticatedRequest) {
    const body = z.object({ groupId: uuid, academicYearId: uuid }).parse(raw ?? {});
    return this.timetable.publish(body.groupId, body.academicYearId, request.auth!.userId);
  }

  @Delete('group/:groupId')
  @RequirePermission('scolarite.groupes')
  clear(
    @Param('groupId') groupId: string,
    @Query('day') d: string,
    @Query('slot') s: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.timetable.clear(
      uuid.parse(groupId),
      day.parse(d),
      slot.parse(s),
      request.auth!.userId,
    );
  }
}
