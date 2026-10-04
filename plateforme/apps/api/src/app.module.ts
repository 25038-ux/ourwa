import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottleGuard } from './throttle.guard.js';
import { ZodExceptionFilter } from './common/zod-exception.filter.js';
import { DbService } from './db/db.service.js';
import { TenantService } from './tenant/tenant.service.js';
import { TenantInterceptor } from './tenant/tenant.interceptor.js';
import { AuditService } from './audit/audit.service.js';
import { AuthService } from './auth/auth.service.js';
import { AuthController } from './auth/auth.controller.js';
import { AuthGuard } from './auth/auth.guard.js';
import { PermissionsGuard } from './auth/permissions.guard.js';
import { PermissionsService } from './auth/permissions.service.js';
import { RateLimitService } from './auth/rate-limit.service.js';
import { SessionsService } from './auth/sessions.service.js';
import { HealthController } from './health/health.controller.js';
import { PlatformController, SchoolsController } from './schools/schools.controller.js';
import { StudentsController } from './students/students.controller.js';
import { AcademicYearService } from './academic/academic-year.service.js';
import { EnrollmentService } from './academic/enrollment.service.js';
import { ReferenceService } from './academic/reference.service.js';
import {
  AcademicYearController,
  EnrollmentController,
  ReferenceController,
} from './academic/academic.controller.js';
import { CollectionService } from './finance/collection.service.js';
import { ConcessionsService } from './finance/concessions.service.js';
import { FeesService } from './finance/fees.service.js';
import { PaymentsService } from './finance/payments.service.js';
import { TenderService } from './finance/tender.service.js';
import { DebtService } from './finance/debt.service.js';
import { BillingModelService } from './finance/billing-model.service.js';
import { TarifsService } from './finance/tarifs.service.js';
import { StudentServicesService } from './finance/student-services.service.js';
import { FacturationController } from './finance/facturation.controller.js';
import {
  ExpensesController,
  FinanceController,
  PaymentMethodsController,
} from './finance/finance.controller.js';
import { ParentController } from './parent/parent.controller.js';
import { NotificationsService } from './parent/notifications.service.js';
import { GradesService } from './grades/grades.service.js';
import { GradesController, TeacherController } from './grades/grades.controller.js';
import { PedagogyService } from './pedagogy/pedagogy.service.js';
import {
  AttendanceController,
  HomeworkController,
  RemarksController,
} from './pedagogy/pedagogy.controller.js';
import { PlatformService } from './platform/platform.service.js';
import { PlatformConsoleController } from './platform/platform.controller.js';
import { ConsoleGuard } from './platform/console.guard.js';
import { EveningService } from './evening/evening.service.js';
import { EveningController } from './evening/evening.controller.js';
import { PayrollService } from './payroll/payroll.service.js';
import { PayrollController } from './payroll/payroll.controller.js';
import { ReportsService } from './reports/reports.service.js';
import { ReportsController } from './reports/reports.controller.js';
import { CommsService } from './comms/comms.service.js';
import { MessagesController, RequestsController } from './comms/comms.controller.js';
import { AdmissionsService } from './admissions/admissions.service.js';
import { AdmissionsController } from './admissions/admissions.controller.js';
import { ExpensesService } from './finance/expenses.service.js';
import { SearchService } from './search/search.service.js';
import { SearchController } from './search/search.controller.js';
import { TimetableService } from './timetable/timetable.service.js';
import { TimetableController } from './timetable/timetable.controller.js';
import { ExpulsionsService } from './discipline/expulsions.service.js';
import { ExpulsionsController } from './discipline/expulsions.controller.js';
import { AccountsService } from './accounts/accounts.service.js';
import { AccountsController } from './accounts/accounts.controller.js';
import { ExamAccessService } from './exams/exam-access.service.js';
import { CacheService } from './cache/cache.service.js';
import { PushService } from './push/push.service.js';
import { PushWorker } from './push/push.worker.js';
import { ExamAccessController } from './exams/exams.controller.js';
import { AttachmentsService } from './attachments/attachments.service.js';
import { AttachmentsController } from './attachments/attachments.controller.js';
import { DocumentsService } from './documents/documents.service.js';
import { DocumentsController } from './documents/documents.controller.js';
import { PersonnelAbsencesService } from './personnel/personnel-absences.service.js';
import { PersonnelAbsencesController } from './personnel/personnel-absences.controller.js';
import { MailService } from './mail/mail.service.js';
import { MailWorker } from './mail/mail.worker.js';

@Module({
  controllers: [
    HealthController,
    AuthController,
    SchoolsController,
    PlatformController,
    StudentsController,
    AcademicYearController,
    ReferenceController,
    EnrollmentController,
    FinanceController,
    FacturationController,
    PaymentMethodsController,
    ParentController,
    GradesController,
    TeacherController,
    AttendanceController,
    RemarksController,
    HomeworkController,
    PlatformConsoleController,
    EveningController,
    PayrollController,
    ReportsController,
    MessagesController,
    RequestsController,
    AdmissionsController,
    ExpensesController,
    SearchController,
    TimetableController,
    ExpulsionsController,
    AccountsController,
    ExamAccessController,
    AttachmentsController,
    DocumentsController,
    PersonnelAbsencesController,
  ],
  providers: [
    DbService,
    CacheService,
    PushService,
    PushWorker,
    TenantService,
    AuditService,
    AuthService,
    SessionsService,
    PermissionsService,
    RateLimitService,
    AcademicYearService,
    ReferenceService,
    EnrollmentService,
    CollectionService,
    ConcessionsService,
    FeesService,
    PaymentsService,
    TenderService,
    DebtService,
    BillingModelService,
    TarifsService,
    StudentServicesService,
    GradesService,
    PedagogyService,
    NotificationsService,
    PlatformService,
    ConsoleGuard,
    EveningService,
    PayrollService,
    ReportsService,
    CommsService,
    AdmissionsService,
    ExpensesService,
    SearchService,
    TimetableService,
    ExpulsionsService,
    AccountsService,
    ExamAccessService,
    AttachmentsService,
    DocumentsService,
    PersonnelAbsencesService,
    MailService,
    MailWorker,
    // Order matters: authenticate, then authorise.
    /**
     * ⚠ BEFORE THE AUTH GUARD, DELIBERATELY. Guards run in registration order,
     * so the ceiling is applied before any work is done — including before a
     * password is verified. Throttling after authentication would leave the
     * expensive path (an Argon2id hash per attempt) wide open to anyone willing
     * to send wrong passwords.
     *
     * It reads `request.auth` when it is there and falls back to the IP when it
     * is not, so an authenticated request still gets the higher, per-user
     * ceiling on every guard pass after the first.
     */
    // ⚠ APRÈS AuthGuard, DÉLIBÉRÉMENT (22/09) : les gardes tournent une fois,
    // dans l'ordre ; avant lui, `request.auth` n'existait jamais et tout le
    // trafic — le site entier, derrière 127.0.0.1 — partageait UN seau de 300
    // requêtes par minute. La connexion reste plafonnée par adresse (elle est
    // publique, AuthGuard la laisse passer sans rien vérifier), et Argon2 ne
    // tourne qu'après toutes les gardes de toute façon.
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: ThrottleGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    // Applied globally rather than per-controller: a new controller that forgot
    // to opt in would otherwise run with no tenant at all.
    { provide: APP_INTERCEPTOR, useClass: TenantInterceptor },
    // Turns a rejected input into 400 with its reason. Without it every
    // `.parse()` failure in the API became an opaque 500 and the message was
    // lost — see the filter's own comment.
    { provide: APP_FILTER, useClass: ZodExceptionFilter },
  ],
})
export class AppModule {}
