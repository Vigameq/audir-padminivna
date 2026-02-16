import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { RouterModule } from '@angular/router';
import { forkJoin } from 'rxjs';
import { AuthState } from '../../auth-state';
import { AuditAnswerRecord, AuditAnswerService } from '../../services/audit-answer.service';
import { AuditPlanRecord, AuditPlanService } from '../../services/audit-plan.service';
import { NcRecord, NcService } from '../../services/nc.service';
import { TemplateService } from '../../services/template.service';

@Component({
  selector: 'app-customer-dashboard',
  imports: [CommonModule, RouterModule],
  templateUrl: './customer-dashboard.html',
  styleUrl: './customer-dashboard.scss',
})
export class CustomerDashboard implements OnInit {
  private readonly auth = inject(AuthState);
  private readonly auditPlanService = inject(AuditPlanService);
  private readonly auditAnswerService = inject(AuditAnswerService);
  protected readonly ncService = inject(NcService);
  private readonly templateService = inject(TemplateService);

  protected progressByAudit: Record<string, { submitted: number; total: number }> = {};
  protected answersByAudit: Record<string, AuditAnswerRecord[]> = {};
  protected ncByAudit: Record<string, NcRecord[]> = {};

  protected get audits(): AuditPlanRecord[] {
    const plans = this.auditPlanService.plans();
    const key = this.auth.email().trim().toLowerCase();
    if (!key) {
      return plans;
    }
    return plans.filter((plan) => (plan.customerId || '').toLowerCase() === key);
  }

  protected get totalAudits(): number {
    return this.audits.length;
  }

  protected get completedAudits(): AuditPlanRecord[] {
    return this.audits.filter((audit) => this.isCompleted(audit));
  }

  protected get inProgressAudits(): AuditPlanRecord[] {
    return this.audits.filter((audit) => !this.isCompleted(audit));
  }

  protected get openNcRecords(): NcRecord[] {
    return this.ncService.records().filter((record) => this.isOpenNc(record));
  }

  protected get resolvedNcRecords(): NcRecord[] {
    return this.ncService.records().filter((record) => !this.isOpenNc(record));
  }

  ngOnInit(): void {
    this.templateService.migrateFromLocal().subscribe();
    this.auditPlanService.syncFromApi().subscribe({
      next: () => this.loadProgress(),
    });
    this.ncService.listRecords().subscribe({
      next: () => this.mapNcRecords(),
    });
  }

  protected progressLabel(audit: AuditPlanRecord): string {
    const progress = this.progressByAudit[audit.code];
    if (!progress) {
      return '—';
    }
    return `${progress.submitted}/${progress.total} answered`;
  }

  protected progressPercent(audit: AuditPlanRecord): number {
    const progress = this.progressByAudit[audit.code];
    if (!progress || progress.total === 0) {
      return 0;
    }
    return Math.min(100, Math.round((progress.submitted / progress.total) * 100));
  }

  protected formatDate(value: string): string {
    if (!value) {
      return '—';
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return value;
    }
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
  }

  protected ncRecordsFor(audit: AuditPlanRecord): NcRecord[] {
    return this.ncByAudit[audit.code] ?? [];
  }

  private loadProgress(): void {
    const audits = this.audits;
    if (!audits.length) {
      this.progressByAudit = {};
      this.answersByAudit = {};
      return;
    }
    forkJoin(audits.map((audit) => this.auditAnswerService.listByAuditCode(audit.code)))
      .subscribe({
        next: (allAnswers) => {
          const nextProgress: Record<string, { submitted: number; total: number }> = {};
          const nextAnswers: Record<string, AuditAnswerRecord[]> = {};
          audits.forEach((audit, index) => {
            const answers = allAnswers[index] ?? [];
            nextAnswers[audit.code] = answers;
            const total = this.getTemplateQuestionCount(audit.auditType);
            const submitted = answers.filter((answer) => answer.status === 'Submitted').length;
            nextProgress[audit.code] = { submitted, total };
          });
          this.answersByAudit = nextAnswers;
          this.progressByAudit = nextProgress;
        },
        error: () => {
          this.progressByAudit = {};
        },
      });
  }

  private mapNcRecords(): void {
    const map: Record<string, NcRecord[]> = {};
    this.ncService.records().forEach((record) => {
      if (!record.auditCode) {
        return;
      }
      if (!map[record.auditCode]) {
        map[record.auditCode] = [];
      }
      map[record.auditCode].push(record);
    });
    this.ncByAudit = map;
  }

  private isCompleted(audit: AuditPlanRecord): boolean {
    const progress = this.progressByAudit[audit.code];
    if (!progress) {
      return false;
    }
    return progress.total > 0 && progress.submitted >= progress.total;
  }

  protected isOpenNc(record: NcRecord): boolean {
    const status = (record.status || '').trim().toLowerCase();
    return status === 'assigned' || status === 'in progress' || status === 'rework';
  }

  private getTemplateQuestionCount(auditType: string): number {
    const template = this.templateService.templates().find((item) => item.name === auditType);
    return template?.questions.length ?? 0;
  }
}
