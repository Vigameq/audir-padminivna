import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { FormsModule, NgForm } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthState } from '../../auth-state';
import { DepartmentService } from '../../services/department.service';
import { RegionService } from '../../services/region.service';
import { ResponseDefinition, ResponseService } from '../../services/response.service';
import { SiteService } from '../../services/site.service';
import {
  ComplaintEscalationRule,
  ComplaintService,
} from '../../services/complaint.service';

@Component({
  selector: 'app-settings',
  imports: [CommonModule, FormsModule],
  templateUrl: './settings.html',
  styleUrl: './settings.scss',
})
export class Settings implements OnInit {
  private readonly auth = inject(AuthState);
  private readonly router = inject(Router);
  private readonly departmentService = inject(DepartmentService);
  private readonly siteService = inject(SiteService);
  private readonly regionService = inject(RegionService);
  private readonly responseService = inject(ResponseService);
  private readonly complaintService = inject(ComplaintService);
  protected newDepartment = '';
  protected newSite = '';
  protected newRegion = '';
  protected showResponseModal = false;
  protected responseName = '';
  protected responseTypeInput = '';
  protected responseTypes: string[] = [];
  protected responseNegativeTypes: string[] = [];
  protected responseTypeNegative = false;
  protected editingResponseId: number | null = null;
  protected escalationRules: ComplaintEscalationRule[] = [];
  protected escalationRuleDrafts: Record<
    number,
    { thresholdHours: number; notifyRole: ComplaintEscalationRule['notifyRole'] }
  > = {};
  protected escalationSaveState: Record<number, 'idle' | 'saving' | 'saved' | 'error'> = {};
  protected readonly escalationRoleOptions: ComplaintEscalationRule['notifyRole'][] = [
    'Manager',
    'Admin',
    'Super Admin',
    'Auditor',
  ];
  protected get responses(): ResponseDefinition[] {
    return this.responseService.responses();
  }

  protected get departments(): string[] {
    return this.departmentService.departments();
  }

  protected get sites(): string[] {
    return this.siteService.sites();
  }

  protected get regions(): string[] {
    return this.regionService.regions();
  }


  protected addDepartment(form: NgForm): void {
    const value = this.newDepartment.trim();
    if (!value) {
      return;
    }
    this.departmentService.createDepartment(value).subscribe({
      next: () => {
        this.newDepartment = '';
        form.resetForm();
      },
    });
  }

  protected removeDepartment(name: string): void {
    this.departmentService.deleteDepartment(name).subscribe();
  }

  protected addSite(form: NgForm): void {
    const value = this.newSite.trim();
    if (!value) {
      return;
    }
    this.siteService.createSite(value).subscribe({
      next: () => {
        this.newSite = '';
        form.resetForm();
      },
    });
  }

  protected removeSite(name: string): void {
    this.siteService.deleteSite(name).subscribe();
  }

  protected addRegion(form: NgForm): void {
    const value = this.newRegion.trim();
    if (!value) {
      return;
    }
    this.regionService.createRegion(value).subscribe({
      next: () => {
        this.newRegion = '';
        form.resetForm();
      },
    });
  }

  protected removeRegion(name: string): void {
    this.regionService.deleteRegion(name).subscribe();
  }

  protected openResponseModal(): void {
    this.editingResponseId = null;
    this.showResponseModal = true;
  }

  protected startEditResponse(response: ResponseDefinition): void {
    this.editingResponseId = response.id ?? null;
    this.responseName = response.name;
    this.responseTypeInput = '';
    this.responseTypes = [...response.types];
    this.responseNegativeTypes = [...response.negativeTypes];
    this.responseTypeNegative = false;
    this.showResponseModal = true;
  }

  protected closeResponseModal(): void {
    this.showResponseModal = false;
    this.editingResponseId = null;
    this.responseName = '';
    this.responseTypeInput = '';
    this.responseTypes = [];
    this.responseNegativeTypes = [];
    this.responseTypeNegative = false;
  }

  protected saveResponse(): void {
    const name = this.responseName.trim();
    if (!name || !this.responseTypes.length) {
      return;
    }
    const payload: ResponseDefinition = {
      name,
      types: [...this.responseTypes],
      negativeTypes: [...this.responseNegativeTypes],
    };
    const request$ = this.editingResponseId
      ? this.responseService.updateResponse(this.editingResponseId, payload)
      : this.responseService.createResponse(payload);
    request$.subscribe({
      next: () => this.closeResponseModal(),
    });
  }

  protected addResponseType(): void {
    const value = this.responseTypeInput.trim();
    if (!value) {
      return;
    }
    if (this.responseTypes.includes(value)) {
      this.responseTypeInput = '';
      return;
    }
    this.responseTypes = [...this.responseTypes, value];
    if (this.responseTypeNegative) {
      this.responseNegativeTypes = [...this.responseNegativeTypes, value];
      this.responseTypeNegative = false;
    }
    this.responseTypeInput = '';
  }

  protected removeResponseType(value: string): void {
    this.responseTypes = this.responseTypes.filter((item) => item !== value);
    this.responseNegativeTypes = this.responseNegativeTypes.filter((item) => item !== value);
  }

  public removeResponse(response: ResponseDefinition): void {
    if (response.id) {
      this.responseService.deleteResponseById(response.id).subscribe();
      return;
    }
    this.responseService.deleteResponseByName(response.name).subscribe();
  }

  protected isNegativeTag(response: ResponseDefinition, tag: string): boolean {
    return response.negativeTypes?.includes(tag);
  }

  protected isNegativeTagDraft(tag: string): boolean {
    return this.responseNegativeTypes.includes(tag);
  }

  protected getEscalationRuleDraft(
    rule: ComplaintEscalationRule
  ): { thresholdHours: number; notifyRole: ComplaintEscalationRule['notifyRole'] } {
    const existing = this.escalationRuleDrafts[rule.id];
    if (existing) {
      return existing;
    }
    const next = {
      thresholdHours: rule.thresholdHours,
      notifyRole: rule.notifyRole,
    };
    this.escalationRuleDrafts[rule.id] = next;
    return next;
  }

  protected updateEscalationThreshold(ruleId: number, value: string | number): void {
    const numeric = Math.max(1, Math.floor(Number(value) || 1));
    const current = this.escalationRuleDrafts[ruleId];
    if (!current) {
      return;
    }
    this.escalationRuleDrafts[ruleId] = {
      ...current,
      thresholdHours: numeric,
    };
    this.escalationSaveState[ruleId] = 'idle';
  }

  protected updateEscalationRole(
    ruleId: number,
    value: ComplaintEscalationRule['notifyRole']
  ): void {
    const current = this.escalationRuleDrafts[ruleId];
    if (!current) {
      return;
    }
    this.escalationRuleDrafts[ruleId] = {
      ...current,
      notifyRole: value,
    };
    this.escalationSaveState[ruleId] = 'idle';
  }

  protected saveEscalationRule(rule: ComplaintEscalationRule): void {
    const draft = this.escalationRuleDrafts[rule.id];
    if (!draft) {
      return;
    }
    this.escalationSaveState[rule.id] = 'saving';
    this.complaintService
      .updateEscalationRule(rule.id, {
        threshold_hours: draft.thresholdHours,
        notify_role: draft.notifyRole,
      })
      .subscribe({
        next: (updated) => {
          this.escalationRules = this.escalationRules.map((item) =>
            item.id === updated.id ? updated : item
          );
          this.escalationRuleDrafts[rule.id] = {
            thresholdHours: updated.thresholdHours,
            notifyRole: updated.notifyRole,
          };
          this.escalationSaveState[rule.id] = 'saved';
        },
        error: () => {
          this.escalationSaveState[rule.id] = 'error';
        },
      });
  }

  ngOnInit(): void {
    if (this.auth.role() !== 'Super Admin') {
      this.router.navigate(['/dashboard']);
      return;
    }
    this.departmentService.migrateFromLocal().subscribe();
    this.siteService.migrateFromLocal().subscribe();
    this.regionService.migrateFromLocal().subscribe();
    this.responseService.migrateFromLocal().subscribe();
    this.complaintService.listEscalationRules().subscribe({
      next: (rules) => {
        this.escalationRules = rules;
        this.escalationRuleDrafts = {};
        this.escalationSaveState = {};
        rules.forEach((rule) => {
          this.escalationRuleDrafts[rule.id] = {
            thresholdHours: rule.thresholdHours,
            notifyRole: rule.notifyRole,
          };
          this.escalationSaveState[rule.id] = 'idle';
        });
      },
    });
  }
}
