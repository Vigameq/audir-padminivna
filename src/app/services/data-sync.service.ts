import { Injectable } from '@angular/core';
import { forkJoin, Observable } from 'rxjs';
import { AuditPlanService } from './audit-plan.service';
import { DepartmentService } from './department.service';
import { RegionService } from './region.service';
import { ResponseService } from './response.service';
import { SiteService } from './site.service';
import { TemplateService } from './template.service';

@Injectable({ providedIn: 'root' })
export class DataSyncService {
  constructor(
    private readonly auditPlanService: AuditPlanService,
    private readonly departmentService: DepartmentService,
    private readonly siteService: SiteService,
    private readonly regionService: RegionService,
    private readonly responseService: ResponseService,
    private readonly templateService: TemplateService
  ) {}

  syncAll(): Observable<unknown> {
    return forkJoin([
      this.auditPlanService.migrateFromLocal(),
      this.departmentService.migrateFromLocal(),
      this.siteService.migrateFromLocal(),
      this.regionService.migrateFromLocal(),
      this.responseService.migrateFromLocal(),
      this.templateService.migrateFromLocal(),
    ]);
  }
}
