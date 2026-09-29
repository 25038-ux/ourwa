import { Controller, Get, Inject, UseGuards } from '@nestjs/common';
import { ConsoleGuard } from '../platform/console.guard.js';
import { TenantService } from '../tenant/tenant.service.js';
import { currentTenant } from '../tenant/tenant.context.js';
import { BillingModelService } from '../finance/billing-model.service.js';

@Controller()
export class SchoolsController {
  constructor(
    @Inject(TenantService) private readonly tenants: TenantService,
    @Inject(BillingModelService) private readonly billing: BillingModelService,
  ) {}

  /** Branding and configuration for the school this request belongs to. */
  @Get('school')
  async current() {
    const { slug } = currentTenant();
    const school = await this.tenants.findBySlug(slug);
    return {
      slug: school.slug,
      name: school.name,
      nameAr: school.name_ar,
      currency: school.currency,
      // Drives `dir` in the web shell: Arabic mirrors the whole interface.
      locale: school.locale,
      brandColor: school.theme_color,
      logoEmoji: school.logo_emoji,
      // 'famille' | 'services' (ADR-0073) : le site montre la page « Frais »,
      // les modes d'étude et les services seulement pour « services ».
      billingModel: await this.billing.current(),
    };
  }
}

// Le registre des écoles n'existe pas plus que la console en école unique.
@UseGuards(ConsoleGuard)
@Controller('platform')
export class PlatformController {
  constructor(@Inject(TenantService) private readonly tenants: TenantService) {}

  /** The branch registry. Above any single school, so it is not tenant-scoped. */
  @Get('schools')
  async list() {
    const schools = await this.tenants.list();
    return schools.map((s) => ({
      slug: s.slug,
      name: s.name,
      nameAr: s.name_ar,
      currency: s.currency,
      brandColor: s.theme_color,
      logoEmoji: s.logo_emoji,
    }));
  }
}
