import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { forkJoin } from 'rxjs';
import { AuthState } from '../../auth-state';
import { AuditAnswerRecord, AuditAnswerService } from '../../services/audit-answer.service';
import { AuditPlanRecord, AuditPlanService } from '../../services/audit-plan.service';
import { NcRecord, NcService } from '../../services/nc.service';
import { TemplateService } from '../../services/template.service';
import { User, UserService } from '../../services/user.service';

@Component({
  selector: 'app-dashboard',
  imports: [CommonModule, FormsModule],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss',
})
export class Dashboard implements OnInit {
  private readonly auth = inject(AuthState);
  private readonly auditPlanService = inject(AuditPlanService);
  private readonly auditAnswerService = inject(AuditAnswerService);
  private readonly ncService = inject(NcService);
  private readonly userService = inject(UserService);
  private readonly templateService = inject(TemplateService);
  protected users: User[] = [];
  protected answersByAudit: Record<string, AuditAnswerRecord[]> = {};
  protected completionMap: Record<string, 'Completed' | 'In Progress' | 'Created'> = {};

  ngOnInit(): void {
    this.auditPlanService.syncFromApi().subscribe({
      next: () => this.loadAuditProgress(),
    });
    this.ncService.listRecords().subscribe({
      next: () => this.loadAuditProgress(),
    });
    this.templateService.syncFromApi().subscribe();
    this.userService.listUsers().subscribe({
      next: (users) => {
        this.users = users;
      },
    });
  }

  protected get dashboardTitle(): string {
    const role = this.auth.role();
    if (role === 'Auditor') {
      return 'Auditor Overview';
    }
    if (role === 'Manager') {
      return 'Manager Overview';
    }
    if (role === 'Super Admin') {
      return 'Super Admin Overview';
    }
    return 'Dashboard';
  }

  protected get isAuditor(): boolean {
    return this.auth.role() === 'Auditor';
  }

  protected get isManager(): boolean {
    return this.auth.role() === 'Manager';
  }

  protected get isSuperAdmin(): boolean {
    return this.auth.role() === 'Super Admin';
  }

  protected get isCustomer(): boolean {
    return this.auth.role().trim().toLowerCase() === 'customer';
  }

  protected get audits(): AuditPlanRecord[] {
    return this.auditPlanService.plans();
  }

  protected get templatesCount(): number {
    return this.templateService.templates().length;
  }

  protected get auditors(): User[] {
    return this.users.filter((user) => user.role === 'Auditor');
  }

  protected get managers(): User[] {
    return this.users.filter((user) => user.role === 'Manager');
  }

  protected get ncRecords(): NcRecord[] {
    return this.ncService.records();
  }

  protected get createdAudits(): AuditPlanRecord[] {
    return this.audits.filter((audit) => this.completionMap[audit.code] === 'Created');
  }

  protected get inProgressAudits(): AuditPlanRecord[] {
    return this.audits.filter((audit) => this.completionMap[audit.code] === 'In Progress');
  }

  protected get completedAudits(): AuditPlanRecord[] {
    return this.audits.filter((audit) => this.completionMap[audit.code] === 'Completed');
  }

  protected get assignedAudits(): AuditPlanRecord[] {
    const fullName = this.currentUserName();
    if (!fullName) {
      return [];
    }
    return this.audits.filter(
      (audit) => audit.auditorName.trim().toLowerCase() === fullName
    );
  }


  protected get assignedOpenFindings(): number {
    const assignedCodes = new Set(this.assignedAudits.map((audit) => audit.code));
    return this.ncRecords.filter((record) => {
      const status = (record.status || '').trim().toLowerCase();
      const isClosed = status === 'closed';
      return assignedCodes.has(record.auditCode) && !isClosed;
    }).length;
  }

  protected get auditorChartMax(): number {
    return Math.max(this.assignedAudits.length, this.assignedOpenFindings, this.pendingReviewCount, 1);
  }

  protected chartPercent(value: number, max: number): number {
    if (!max) {
      return 0;
    }
    return Math.min(100, Math.round((value / max) * 100));
  }

  protected get pendingReviewCount(): number {
    const assignedCodes = new Set(this.assignedAudits.map((audit) => audit.code));
    return this.ncRecords.filter((record) => {
      const status = (record.status || '').trim().toLowerCase();
      return status === 'resolution submitted' && assignedCodes.has(record.auditCode);
    }).length;
  }

  protected get pendingReviewAll(): number {
    return this.ncRecords.filter((record) => {
      const status = (record.status || '').trim().toLowerCase();
      return status === 'resolution submitted';
    }).length;
  }

  protected get openNcCount(): number {
    return this.ncRecords.filter((record) => {
      const status = (record.status || '').trim().toLowerCase();
      return status === 'assigned' || status === 'in progress' || status === 'rework';
    }).length;
  }

  protected get closedNcCount(): number {
    return this.ncRecords.filter((record) => {
      const status = (record.status || '').trim().toLowerCase();
      return status === 'closed';
    }).length;
  }

  protected get ncStatusCounts(): Record<string, number> {
    const counts: Record<string, number> = {
      Assigned: 0,
      'In Progress': 0,
      Rework: 0,
      'Resolution Submitted': 0,
      Closed: 0,
    };
    this.ncRecords.forEach((record) => {
      const status = (record.status || 'Assigned').trim().toLowerCase();
      if (status === 'assigned') counts['Assigned'] += 1;
      else if (status === 'in progress') counts['In Progress'] += 1;
      else if (status === 'rework') counts['Rework'] += 1;
      else if (status === 'resolution submitted') counts['Resolution Submitted'] += 1;
      else if (status === 'closed') counts['Closed'] += 1;
    });
    return counts;
  }

  protected get auditPipelineMax(): number {
    return Math.max(
      this.createdAudits.length,
      this.inProgressAudits.length,
      this.completedAudits.length,
      1
    );
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


  private currentUserName(): string {
    const first = this.auth.firstName().trim();
    const last = this.auth.lastName().trim();
    return `${first} ${last}`.trim().toLowerCase();
  }

  private loadAuditProgress(): void {
    const audits = this.audits;
    if (!audits.length) {
      this.answersByAudit = {};
      this.completionMap = {};
      return;
    }
    forkJoin(audits.map((audit) => this.auditAnswerService.listByAuditCode(audit.code))).subscribe({
      next: (allAnswers) => {
        const pendingReviewByAudit = new Set(
          this.ncRecords
            .filter(
              (record) =>
                (record.status || '').trim().toLowerCase() === 'resolution submitted'
            )
            .map((record) => record.auditCode)
        );
        const openNcByAudit = new Set(
          this.ncRecords
            .filter((record) => {
              const status = (record.status || '').trim().toLowerCase();
              return status === 'assigned' || status === 'in progress' || status === 'rework';
            })
            .map((record) => record.auditCode)
        );
        const nextAnswers: Record<string, AuditAnswerRecord[]> = {};
        const nextMap: Record<string, 'Completed' | 'In Progress' | 'Created'> = {};
        audits.forEach((audit, index) => {
          const answers = allAnswers[index] ?? [];
          nextAnswers[audit.code] = answers;
          if (!answers.length) {
            nextMap[audit.code] = 'Created';
            return;
          }
          const totalQuestions = this.getTemplateQuestionCount(audit.auditType);
          const submittedCount = answers.filter((answer) => answer.status === 'Submitted').length;
          const hasPendingReview = pendingReviewByAudit.has(audit.code);
          const hasOpenNc = openNcByAudit.has(audit.code);
          nextMap[audit.code] =
            totalQuestions > 0 &&
            submittedCount >= totalQuestions &&
            !hasPendingReview &&
            !hasOpenNc
              ? 'Completed'
              : 'In Progress';
        });
        this.answersByAudit = nextAnswers;
        this.completionMap = nextMap;
      },
    });
  }

  private getTemplateQuestionCount(auditType: string): number {
    const template = this.templateService.templates().find((item) => item.name === auditType);
    return template?.questions.length ?? 0;
  }
}
