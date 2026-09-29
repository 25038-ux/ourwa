import { Controller, Get, Inject, NotFoundException, Param, Query } from '@nestjs/common';
import { z } from 'zod';
import { SearchService } from './search.service.js';
import { RequirePermission } from '../auth/permissions.guard.js';

const uuid = z.string().uuid();

@Controller('search')
export class SearchController {
  constructor(@Inject(SearchService) private readonly search: SearchService) {}

  @Get()
  @RequirePermission('recherche.globale')
  find(@Query('q') q: string) {
    return this.search.search(z.string().trim().min(2).max(80).parse(q));
  }

  /*
   * LES DEUX FICHES DE `recherche.php`.
   *
   * ⚠ MÊME PERMISSION QUE LA RECHERCHE, ET C'EST DÉLIBÉRÉ. Ces routes prennent
   * un identifiant dans l'URL : quiconque peut chercher peut ouvrir la fiche de
   * ce qu'il a trouvé, et personne d'autre. RLS borne le résultat à l'école du
   * jeton, donc un identifiant d'une autre école rend 404, jamais une fiche.
   */
  @Get('student/:id')
  @RequirePermission('recherche.globale')
  async student(@Param('id') id: string) {
    const student = await this.search.studentProfile(uuid.parse(id));
    if (!student) throw new NotFoundException('Étudiant introuvable.');
    return { student, grades: await this.search.studentGrades(student.id) };
  }

  @Get('teacher/:id')
  @RequirePermission('recherche.globale')
  async teacher(@Param('id') id: string) {
    const teacher = await this.search.teacherProfile(uuid.parse(id));
    if (!teacher) throw new NotFoundException('Professeur introuvable.');
    return { teacher, teachings: await this.search.teacherTeachings(teacher.id) };
  }
}
