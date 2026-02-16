import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { FormsModule, NgForm } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { forkJoin } from 'rxjs';
import { AuthState } from '../../auth-state';
import { AuditAnswerRecord, AuditAnswerService } from '../../services/audit-answer.service';
import { AuditPlanRecord, AuditPlanService } from '../../services/audit-plan.service';
import { DepartmentService } from '../../services/department.service';
import { NcRecord, NcService } from '../../services/nc.service';
import { RegionService } from '../../services/region.service';
import { ResponseService } from '../../services/response.service';
import { SiteService } from '../../services/site.service';
import { TemplateService } from '../../services/template.service';
import { User, UserService } from '../../services/user.service';

@Component({
  selector: 'app-audit-manage',
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './audit-manage.html',
  styleUrl: './audit-manage.scss',
})
export class AuditManage implements OnInit {
  private readonly auditPlanService = inject(AuditPlanService);
  private readonly auditAnswerService = inject(AuditAnswerService);
  private readonly ncService = inject(NcService);
  protected readonly auth = inject(AuthState);
  private readonly userService = inject(UserService);
  private readonly departmentService = inject(DepartmentService);
  private readonly siteService = inject(SiteService);
  private readonly regionService = inject(RegionService);
  private readonly responseService = inject(ResponseService);
  private readonly templateService = inject(TemplateService);

  protected auditors: User[] = [];
  protected customers: User[] = [];
  protected activeAudit: AuditPlanRecord | null = null;
  protected editForm = {
    startDate: '',
    endDate: '',
    auditType: '',
    auditSubtype: '',
    auditorName: '',
    department: '',
    locationCity: '',
    site: '',
    country: '',
    region: '',
    auditNote: '',
    responseType: '',
    assetScopeCount: 1,
    customerId: '',
  };
  protected readonly assetScopeOptions = Array.from({ length: 150 }, (_, index) => index + 1);
  protected viewAudit: AuditPlanRecord | null = null;
  protected viewResponses: {
    question: string;
    response: string;
    assignedNc: string;
    note: string;
    status: string;
    submittedAt: string;
    ncStatus: string;
  }[] = [];

  protected completionMap: Record<string, 'Completed' | 'In Progress'> = {};
  protected answersByAudit: Record<string, AuditAnswerRecord[]> = {};
  protected activeTab: 'created' | 'inProgress' | 'completed' = 'created';
  protected readonly pageSize = 10;
  protected pageIndex = 1;
  protected totalCount = 0;
  protected pagedAudits: AuditPlanRecord[] = [];

  protected get audits(): AuditPlanRecord[] {
    return this.pagedAudits;
  }

  protected get auditSubtypes(): string[] {
    return this.templateService.templates().map((template) => template.name);
  }

  protected get completedAudits(): AuditPlanRecord[] {
    return this.audits.filter((audit) => this.completionMap[audit.code] === 'Completed');
  }

  protected get inProgressAudits(): AuditPlanRecord[] {
    return this.audits.filter(
      (audit) =>
        this.completionMap[audit.code] !== 'Completed' && !this.isCreatedAudit(audit)
    );
  }

  protected get createdAudits(): AuditPlanRecord[] {
    return this.audits.filter((audit) => this.isCreatedAudit(audit));
  }

  protected get activeAudits(): AuditPlanRecord[] {
    if (this.activeTab === 'completed') {
      return this.completedAudits;
    }
    if (this.activeTab === 'inProgress') {
      return this.inProgressAudits;
    }
    return this.createdAudits;
  }

  protected get totalPages(): number {
    return Math.max(1, Math.ceil(this.totalCount / this.pageSize));
  }

  protected get activeTabLabel(): string {
    if (this.activeTab === 'completed') {
      return 'completed';
    }
    if (this.activeTab === 'inProgress') {
      return 'in-progress';
    }
    return 'created';
  }

  protected readonly citiesByCountry: Record<string, string[]> = {
    India: [
      'Agartala',
      'Agra',
      'Ahmedabad',
      'Ajmer',
      'Aligarh',
      'Allahabad',
      'Amritsar',
      'Aurangabad',
      'Bengaluru',
      'Bhopal',
      'Bhubaneswar',
      'Chandigarh',
      'Chennai',
      'Coimbatore',
      'Cuttack',
      'Dehradun',
      'Delhi',
      'Dhanbad',
      'Faridabad',
      'Gaya',
      'Ghaziabad',
      'Gurugram',
      'Guwahati',
      'Gwalior',
      'Hyderabad',
      'Indore',
      'Jaipur',
      'Jabalpur',
      'Jamshedpur',
      'Jodhpur',
      'Kanpur',
      'Kochi',
      'Kolkata',
      'Kota',
      'Kozhikode',
      'Lucknow',
      'Ludhiana',
      'Madurai',
      'Mangaluru',
      'Meerut',
      'Mumbai',
      'Mysuru',
      'Nagpur',
      'Nashik',
      'Noida',
      'Panaji',
      'Patna',
      'Pimpri-Chinchwad',
      'Pune',
      'Raipur',
      'Rajkot',
      'Ranchi',
      'Surat',
      'Thane',
      'Thiruvananthapuram',
      'Tiruchirappalli',
      'Udaipur',
      'Vadodara',
      'Varanasi',
      'Vijayawada',
      'Visakhapatnam',
    ],
    USA: [
      'Atlanta',
      'Austin',
      'Baltimore',
      'Boston',
      'Charlotte',
      'Chicago',
      'Columbus',
      'Dallas',
      'Denver',
      'Detroit',
      'Houston',
      'Indianapolis',
      'Jacksonville',
      'Kansas City',
      'Las Vegas',
      'Los Angeles',
      'Miami',
      'Minneapolis',
      'Nashville',
      'New York',
      'Orlando',
      'Philadelphia',
      'Phoenix',
      'Pittsburgh',
      'Portland',
      'Raleigh',
      'San Antonio',
      'San Diego',
      'San Francisco',
      'San Jose',
      'Seattle',
      'Tampa',
      'Washington, DC',
    ],
    Canada: [
      'Calgary',
      'Edmonton',
      'Halifax',
      'Hamilton',
      'Kitchener',
      'London',
      'Montreal',
      'Ottawa',
      'Quebec City',
      'Regina',
      'Saskatoon',
      "St. John's",
      'Toronto',
      'Vancouver',
      'Victoria',
      'Winnipeg',
    ],
  };

  protected get cities(): string[] {
    return this.citiesByCountry[this.editForm.country] ?? [];
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

  protected get responses(): string[] {
    return this.responseService.responses().map((response) => response.name);
  }

  private readonly evidenceBaseUrl = 'https://tierx-internal.sgp1.digitaloceanspaces.com';

  protected getEvidenceFolderUrl(audit: AuditPlanRecord): string {
    return `${this.evidenceBaseUrl}/${audit.code}/`;
  }

  ngOnInit(): void {
    this.departmentService.migrateFromLocal().subscribe();
    this.siteService.migrateFromLocal().subscribe();
    this.regionService.migrateFromLocal().subscribe();
    this.responseService.migrateFromLocal().subscribe();
    this.templateService.migrateFromLocal().subscribe();
    this.ncService.listRecords().subscribe({
      next: () => this.loadPage(),
    });
    this.userService.listUsers().subscribe({
      next: (users) => {
        this.auditors = users.filter((user) => user.role === 'Auditor');
        this.customers = users.filter((user) => user.role === 'Customer');
      },
    });
    this.loadPage();
  }

  protected openEdit(audit: AuditPlanRecord): void {
    this.activeAudit = audit;
    this.editForm = {
      startDate: audit.startDate,
      endDate: audit.endDate,
      auditType: audit.auditType,
      auditSubtype: audit.auditSubtype,
      auditorName: audit.auditorName,
      department: audit.department,
      locationCity: audit.locationCity,
      site: audit.site,
      country: audit.country,
      region: audit.region,
      auditNote: audit.auditNote,
      responseType: audit.responseType,
      assetScopeCount:
        audit.assetScopeCount ??
        (audit.assetScope?.length ? Math.max(...audit.assetScope) : 1),
      customerId: audit.customerId || '',
    };
  }

  protected closeEdit(form: NgForm): void {
    form.resetForm();
    this.activeAudit = null;
  }

  protected saveEdit(form: NgForm): void {
    if (!this.activeAudit || form.invalid) {
      return;
    }
    if (this.completionMap[this.activeAudit.code] === 'Completed') {
      return;
    }
    this.auditPlanService
      .updatePlanApi(this.activeAudit.id, {
        startDate: this.editForm.startDate,
        endDate: this.editForm.endDate,
        auditorName: this.editForm.auditorName,
        department: this.editForm.department,
        locationCity: this.editForm.locationCity,
        site: this.editForm.site,
        country: this.editForm.country,
        region: this.editForm.region,
        auditNote: this.editForm.auditNote,
        responseType: this.editForm.responseType,
        customerId: this.editForm.customerId || undefined,
        assetScope: Array.from(
          { length: Number(this.editForm.assetScopeCount) || 1 },
          (_, index) => index + 1
        ),
      })
      .subscribe({
        next: () => this.closeEdit(form),
      });
  }

  protected openView(audit: AuditPlanRecord): void {
    this.viewAudit = audit;
    const cached = this.answersByAudit[audit.code];
    if (cached) {
      this.viewResponses = this.buildViewResponses(cached);
      return;
    }
    this.auditAnswerService.listByAuditCode(audit.code).subscribe({
      next: (answers) => {
        this.answersByAudit[audit.code] = answers;
        this.viewResponses = this.buildViewResponses(answers);
      },
      error: () => {
        this.viewResponses = [];
      },
    });
  }

  protected closeView(): void {
    this.viewAudit = null;
    this.viewResponses = [];
  }

  protected deleteAudit(audit: AuditPlanRecord): void {
    if (this.auth.role() !== 'Manager') {
      return;
    }
    if (!this.isCreatedAudit(audit)) {
      return;
    }
    if (!confirm('Delete this audit? This cannot be undone.')) {
      return;
    }
    if (this.activeAudit?.id === audit.id) {
      this.activeAudit = null;
    }
    if (this.viewAudit?.id === audit.id) {
      this.closeView();
    }
    this.auditPlanService.deletePlanApi(audit.id).subscribe({
      next: () => {
        this.loadPage();
      },
    });
  }

  protected setTab(tab: 'created' | 'inProgress' | 'completed'): void {
    this.activeTab = tab;
    this.pageIndex = 1;
    this.loadPage();
  }

  protected goToPage(page: number): void {
    this.pageIndex = Math.min(Math.max(page, 1), this.totalPages);
    this.loadPage();
  }

  protected nextPage(): void {
    this.goToPage(this.pageIndex + 1);
  }

  protected prevPage(): void {
    this.goToPage(this.pageIndex - 1);
  }

  protected getAuditProgress(audit: AuditPlanRecord): { nc: number; nonNc: number } {
    const answers = this.answersByAudit[audit.code] ?? [];
    const answered = answers.filter((answer) => (answer.response || '').trim());
    const nc = answered.filter(
      (answer) =>
        answer.responseIsNegative || (answer.assignedNc || '').trim().length > 0
    ).length;
    const nonNc = answered.length - nc;
    return { nc, nonNc };
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

  private isCreatedAudit(audit: AuditPlanRecord): boolean {
    const answers = this.answersByAudit[audit.code];
    return !answers || answers.length === 0;
  }

  private loadAuditProgress(): void {
    const audits = this.audits;
    if (!audits.length) {
      this.completionMap = {};
      this.answersByAudit = {};
      return;
    }
    forkJoin(
      audits.map((audit) => this.auditAnswerService.listByAuditCode(audit.code))
    ).subscribe({
      next: (allAnswers) => {
        const pendingReviewByAudit = new Set(
          this.ncService
            .records()
            .filter(
              (record) =>
                (record.status || '').trim().toLowerCase() === 'resolution submitted'
            )
            .map((record) => record.auditCode)
        );
        const openNcByAudit = new Set(
          this.ncService
            .records()
            .filter((record) => {
              const status = (record.status || '').trim().toLowerCase();
              return status === 'assigned' || status === 'in progress' || status === 'rework';
            })
            .map((record) => record.auditCode)
        );
        const nextMap: Record<string, 'Completed' | 'In Progress'> = {};
        const nextAnswers: Record<string, AuditAnswerRecord[]> = {};
        audits.forEach((audit, index) => {
          const answers = allAnswers[index] ?? [];
          nextAnswers[audit.code] = answers;
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
        this.completionMap = nextMap;
        this.answersByAudit = nextAnswers;
      },
    });
  }

  private loadPage(): void {
    this.auditPlanService.fetchPage(this.pageIndex, this.pageSize).subscribe({
      next: ({ items, total }) => {
        this.pagedAudits = items;
        this.totalCount = total;
        this.loadAuditProgress();
      },
    });
  }

  private buildViewResponses(answers: AuditAnswerRecord[]): {
    question: string;
    response: string;
    assignedNc: string;
    note: string;
    status: string;
    submittedAt: string;
    ncStatus: string;
  }[] {
    const ncStatusByAnswer = new Map<string, string>();
    this.ncService.records().forEach((record) => {
      if (!record.answerId) {
        return;
      }
      ncStatusByAnswer.set(record.answerId, record.status || '');
    });

    return [...answers]
      .sort((a, b) => a.questionIndex - b.questionIndex)
      .map((answer) => ({
        question: answer.questionText || '—',
        response: answer.response || '—',
        assignedNc: answer.assignedNc || '',
        note: answer.note || '',
        status: answer.status || '—',
        submittedAt: answer.updatedAt || answer.createdAt || '',
        ncStatus: ncStatusByAnswer.get(answer.id) || '',
      }));
  }

  private getTemplateQuestionCount(auditType: string): number {
    const template = this.templateService.templates().find((item) => item.name === auditType);
    return template?.questions.length ?? 0;
  }

  private isAuditOwnedByCurrentAuditor(code: string): boolean {
    const audit = this.pagedAudits.find((item) => item.code === code);
    if (!audit) {
      return false;
    }
    const first = this.auth.firstName().trim();
    const last = this.auth.lastName().trim();
    const fullName = `${first} ${last}`.trim().toLowerCase();
    if (!fullName) {
      return false;
    }
    return audit.auditorName.trim().toLowerCase() === fullName;
  }
}
