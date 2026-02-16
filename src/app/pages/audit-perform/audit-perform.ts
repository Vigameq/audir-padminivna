import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import QRCode from 'qrcode';
import { firstValueFrom } from 'rxjs';
import { AuthState } from '../../auth-state';
import { AuditAnswerService } from '../../services/audit-answer.service';
import { AuditPlanRecord, AuditPlanService } from '../../services/audit-plan.service';
import { DepartmentService } from '../../services/department.service';
import { ResponseService } from '../../services/response.service';
import { TemplateRecord, TemplateService } from '../../services/template.service';

@Component({
  selector: 'app-audit-perform',
  imports: [CommonModule, FormsModule],
  templateUrl: './audit-perform.html',
  styleUrl: './audit-perform.scss',
})
export class AuditPerform implements OnInit {
  private readonly auditPlanService = inject(AuditPlanService);
  private readonly auditAnswerService = inject(AuditAnswerService);
  private readonly templateService = inject(TemplateService);
  private readonly responseService = inject(ResponseService);
  private readonly departmentService = inject(DepartmentService);
  private readonly auth = inject(AuthState);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  protected get audits() {
    const audits = this.pagedAudits;
    const start = this.filterStart ? new Date(this.filterStart) : null;
    const end = this.filterEnd ? new Date(this.filterEnd) : null;
    const filtered = audits.filter((audit) => {
      const created = new Date(audit.createdAt);
      if (start && created < start) {
        return false;
      }
      if (end) {
        const endOfDay = new Date(end);
        endOfDay.setHours(23, 59, 59, 999);
        if (created > endOfDay) {
          return false;
        }
      }
      return true;
    });
    const scoped =
      this.auth.role() === 'Auditor'
        ? filtered.filter((audit) => this.isAssignedToCurrentUser(audit))
        : filtered;
    const visible = scoped.filter((audit) => !this.completedAuditCodes.has(audit.code));
    return visible.sort((a, b) =>
      this.sortOrder === 'asc'
        ? a.createdAt.localeCompare(b.createdAt)
        : b.createdAt.localeCompare(a.createdAt)
    );
  }

  protected activeAudit: AuditPlanRecord | null = null;
  protected activeTemplate: TemplateRecord | null = null;
  protected responseOptions: string[] = [];
  protected negativeResponseOptions: string[] = [];
  protected responseSelections: string[] = [];
  protected noteWords: number[] = [];
  protected ncAssignments: string[] = [];
  protected savedQuestions: boolean[] = [];
  protected evidenceFiles: string[] = [];
  protected evidenceDataUrls: string[] = [];
  protected evidenceItems: { name: string; type: string; key?: string; dataUrl?: string }[][] = [];
  protected noteEntries: string[] = [];
  protected get assetNumberOptions(): string[] {
    return this.assetScope.length ? this.assetScope : ['1'];
  }
  protected assetScope: string[] = [];
  protected activeAsset = '';
  protected responsesByAsset: Record<string, string[]> = {};
  protected notesByAsset: Record<string, string[]> = {};
  protected ncByAsset: Record<string, string[]> = {};
  protected savedByAsset: Record<string, boolean[]> = {};
  protected statusByAsset: Record<string, ('Saved' | 'Submitted' | '')[]> = {};
  protected evidenceFilesByAsset: Record<string, string[]> = {};
  protected evidenceDataUrlsByAsset: Record<string, string[]> = {};
  protected evidenceItemsByAsset: Record<
    string,
    { name: string; type: string; key?: string; dataUrl?: string }[][]
  > = {};
  protected ncErrors: boolean[] = [];
  protected noteHover: string | null = null;
  protected isQrGenerating: Record<string, boolean> = {};
  private completedAuditCodes = new Set<string>();

  protected get totalQuestions(): number {
    return this.activeTemplate?.questions.length ?? 0;
  }

  protected get answeredCount(): number {
    return (this.responseSelections ?? []).filter((value) => value && value.trim().length > 0).length;
  }
  protected filterStart = '';
  protected filterEnd = '';
  protected sortOrder: 'asc' | 'desc' = 'desc';
  protected readonly pageSize = 10;
  protected pageIndex = 1;
  protected totalCount = 0;
  protected pagedAudits: AuditPlanRecord[] = [];

  ngOnInit(): void {
    this.templateService.migrateFromLocal().subscribe();
    this.responseService.migrateFromLocal().subscribe();
    this.departmentService.migrateFromLocal().subscribe();
    this.loadPage();
    this.route.paramMap.subscribe((params) => {
      const code = params.get('code');
      if (!code) {
        return;
      }
      void this.loadAuditByCode(code);
    });
    this.refreshCompletionState();
  }

  private async loadAuditByCode(code: string): Promise<void> {
    const audit =
      this.pagedAudits.find((item) => item.code === code) ??
      (await firstValueFrom(this.auditPlanService.fetchByCode(code)));
    if (!audit) {
      return;
    }
    await this.ensureReferenceDataLoaded();
    await this.openPerform(audit);
  }

  private loadPage(): void {
    this.auditPlanService.fetchPage(this.pageIndex, this.pageSize).subscribe({
      next: ({ items, total }) => {
        this.pagedAudits = items;
        this.totalCount = total;
      },
    });
  }

  protected async openPerform(audit: AuditPlanRecord): Promise<void> {
    if (this.auth.role() === 'Auditor' && !this.isAssignedToCurrentUser(audit)) {
      return;
    }
    await this.ensureReferenceDataLoaded();
    this.activeAudit = audit;
    this.router.navigate(['/audit-perform', audit.code], { replaceUrl: true });
    this.activeTemplate = this.resolveTemplateForAudit(audit);
    const response = this.responseService
      .responses()
      .find((item) => item.name === audit.responseType);
    this.responseOptions = response?.types ?? [];
    this.negativeResponseOptions = response?.negativeTypes ?? [];
    this.resetQuestionState();
    if (this.activeAudit) {
      this.auditAnswerService.listByAuditCode(this.activeAudit.code).subscribe({
        next: (answers) => this.applyAnswers(answers),
      });
    }
  }

  private async ensureReferenceDataLoaded(): Promise<void> {
    if (!this.templateService.templates().length) {
      await firstValueFrom(this.templateService.syncFromApi());
    }
    if (!this.responseService.responses().length) {
      await firstValueFrom(this.responseService.syncFromApi());
    }
    if (!this.departmentService.departments().length) {
      await firstValueFrom(this.departmentService.syncFromApi());
    }
  }

  protected closePerform(): void {
    this.activeAudit = null;
    this.activeTemplate = null;
    this.responseOptions = [];
    this.negativeResponseOptions = [];
    this.responseSelections = [];
    this.noteWords = [];
    this.ncAssignments = [];
    this.savedQuestions = [];
    this.evidenceFiles = [];
    this.evidenceDataUrls = [];
    this.evidenceItems = [];
    this.noteEntries = [];
    this.assetScope = [];
    this.activeAsset = '';
    this.responsesByAsset = {};
    this.notesByAsset = {};
    this.ncByAsset = {};
    this.savedByAsset = {};
    this.statusByAsset = {};
    this.evidenceFilesByAsset = {};
    this.evidenceDataUrlsByAsset = {};
    this.evidenceItemsByAsset = {};
    this.ncErrors = [];
    this.router.navigate(['/audit-perform'], { replaceUrl: true });
  }

  protected get totalPages(): number {
    return Math.max(1, Math.ceil(this.totalCount / this.pageSize));
  }

  protected nextPage(): void {
    this.goToPage(this.pageIndex + 1);
  }

  protected prevPage(): void {
    this.goToPage(this.pageIndex - 1);
  }

  protected goToPage(page: number): void {
    this.pageIndex = Math.min(Math.max(page, 1), this.totalPages);
    this.loadPage();
  }

  protected get departments(): string[] {
    return this.departmentService.departments();
  }

  protected saveQuestion(index: number): void {
    if (!this.validateNcAssignment(index)) {
      return;
    }
    this.persistAnswer(index, 'Saved');
  }

  protected submitQuestion(index: number): void {
    if (!this.activeAudit || !this.activeTemplate) {
      return;
    }
    const response = this.responseSelections[index];
    if (!response) {
      return;
    }
    if (!this.validateNcAssignment(index)) {
      return;
    }
    this.persistAnswer(index, 'Submitted');
  }

  protected submitAllQuestions(): void {
    if (!this.activeAudit || !this.activeTemplate) {
      return;
    }
    const totalQuestions = this.activeTemplate.questions.length;
    const hasAllAnswers =
      this.responseSelections.length === totalQuestions &&
      this.responseSelections.every((response) => response?.trim());
    if (!hasAllAnswers) {
      window.alert('Please answer all questions before submitting.');
      return;
    }
    const missingNc = this.responseSelections.some((_response, index) => !this.validateNcAssignment(index));
    if (missingNc) {
      window.alert('Please assign NC for all Not OK responses before submitting.');
      return;
    }
    const confirmed = window.confirm(
      `Are you sure you want to submit asset ${this.activeAsset || '1'}?`
    );
    if (!confirmed) {
      return;
    }
    const submissions = this.responseSelections.map((_response, index) =>
      this.persistAnswer(index, 'Submitted')
    );
    Promise.all(submissions).then(() => {
      if (this.areAllAssetsSubmitted()) {
        this.markAuditSubmitted(this.activeAudit?.code ?? '');
        this.closePerform();
        return;
      }
      const next = this.getNextIncompleteAsset();
      if (next) {
        this.setActiveAsset(next);
        window.alert(`Asset ${this.activeAsset} submitted. Continue with asset ${next}.`);
      }
    });
  }

  protected isNegativeSelection(index: number): boolean {
    const selected = this.responseSelections[index];
    return !!selected && this.negativeResponseOptions.includes(selected);
  }

  protected onResponseChange(index: number): void {
    if (!this.isNegativeSelection(index)) {
      this.ncAssignments[index] = '';
      this.ncErrors[index] = false;
      return;
    }
    this.validateNcAssignment(index);
  }

  protected onNcChange(index: number): void {
    this.validateNcAssignment(index);
  }

  protected onAssetScopeChange(): void {
    if (!this.assetScope.length) {
      this.assetScope = ['1'];
    }
    const sorted = [...new Set(this.assetScope)].sort(
      (a, b) => Number(a) - Number(b)
    );
    this.assetScope = sorted;
    this.persistAssetScope();
    if (this.activeAudit) {
      this.auditPlanService.updatePlanApi(this.activeAudit.id, {
        assetScope: this.assetScope.map((value) => Number(value)).filter((value) => !Number.isNaN(value)),
      }).subscribe();
    }
    if (!this.assetScope.includes(this.activeAsset)) {
      this.setActiveAsset(this.assetScope[0]);
    }
    this.assetScope.forEach((asset) => this.ensureAssetState(asset));
  }

  onAssetChipClick(asset: string): void {
    if (!asset) {
      return;
    }
    this.setActiveAsset(asset);
  }

  protected onActiveAssetChange(): void {
    if (!this.activeAsset) {
      this.activeAsset = this.assetScope[0] ?? '1';
    }
    this.setActiveAsset(this.activeAsset);
  }

  isAssetComplete(asset: string): boolean {
    if (!this.activeTemplate) {
      return false;
    }
    const statuses = this.statusByAsset[asset];
    if (!statuses || statuses.length < this.activeTemplate.questions.length) {
      return false;
    }
    return this.activeTemplate.questions.every((_, index) => statuses[index] === 'Submitted');
  }

  protected areAllAssetsComplete(): boolean {
    if (!this.activeTemplate) {
      return false;
    }
    const assets = this.assetScope.length ? this.assetScope : ['1'];
    return assets.every((asset) => this.isAssetComplete(asset));
  }

  protected setActiveAsset(asset: string): void {
    if (!asset) {
      return;
    }
    this.ensureAssetState(asset);
    this.loadEvidenceForAsset(asset);
    this.activeAsset = asset;
    this.responseSelections = this.responsesByAsset[asset] ?? [];
    this.noteEntries = this.notesByAsset[asset] ?? [];
    this.ncAssignments = this.ncByAsset[asset] ?? [];
    this.savedQuestions = this.savedByAsset[asset] ?? [];
    this.evidenceFiles = this.evidenceFilesByAsset[asset] ?? [];
    this.evidenceDataUrls = this.evidenceDataUrlsByAsset[asset] ?? [];
    this.evidenceItems = this.evidenceItemsByAsset[asset] ?? [];
    this.noteWords = this.noteEntries.map((value) => this.countWords(value));
    this.ncErrors = this.activeTemplate
      ? new Array(this.activeTemplate.questions.length).fill(false)
      : [];
  }

  private resetQuestionState(): void {
    this.responsesByAsset = {};
    this.notesByAsset = {};
    this.ncByAsset = {};
    this.savedByAsset = {};
    this.statusByAsset = {};
    this.evidenceFilesByAsset = {};
    this.evidenceDataUrlsByAsset = {};
    this.evidenceItemsByAsset = {};
    this.noteWords = this.activeTemplate
      ? new Array(this.activeTemplate.questions.length).fill(0)
      : [];
    this.assetScope = this.loadAssetScope();
    if (!this.assetScope.length) {
      this.assetScope = ['1'];
    }
    this.assetScope.forEach((asset) => this.ensureAssetState(asset));
    this.setActiveAsset(this.assetScope[0]);
    this.ncErrors = this.activeTemplate
      ? new Array(this.activeTemplate.questions.length).fill(false)
      : [];
  }

  private applyAnswers(answers: {
    questionIndex: number;
    assetNumber?: number | null;
    response?: string | null;
    assignedNc?: string | null;
    note?: string | null;
    evidenceName?: string | null;
    evidenceDataUrl?: string | null;
    evidenceUrls?: string[] | null;
    status?: string | null;
  }[]): void {
    answers.forEach((answer) => {
      const index = answer.questionIndex;
      const asset = String(answer.assetNumber ?? 1);
      if (!this.assetScope.includes(asset)) {
        return;
      }
      this.ensureAssetState(asset);
      const responses = this.responsesByAsset[asset];
      const nc = this.ncByAsset[asset];
      const notes = this.notesByAsset[asset];
      const saved = this.savedByAsset[asset];
      const statuses = this.statusByAsset[asset];
      const files = this.evidenceFilesByAsset[asset];
      const dataUrls = this.evidenceDataUrlsByAsset[asset];
      const items = this.evidenceItemsByAsset[asset];
      responses[index] = answer.response ?? '';
      nc[index] = answer.assignedNc ?? '';
      notes[index] = answer.note ?? '';
      files[index] = answer.evidenceName ?? '';
      dataUrls[index] = answer.evidenceDataUrl ?? '';
      const urls = Array.isArray(answer.evidenceUrls)
        ? answer.evidenceUrls
        : dataUrls[index]
          ? [dataUrls[index]]
          : [];
      items[index] = urls.map((url, itemIndex) => {
        const key = this.extractEvidenceKey(url);
        return {
          name: itemIndex === 0 ? files[index] || 'Evidence' : `Evidence ${itemIndex + 1}`,
          type: url.endsWith('.mp4') || url.endsWith('.webm') || url.endsWith('.mov') ? 'video/mp4' : 'image/png',
          key,
          dataUrl: key ? undefined : url,
        };
      });
      this.signEvidenceItems(items[index], asset, index);
      saved[index] = !!answer.status;
      statuses[index] =
        (answer.status as 'Saved' | 'Submitted' | '') ?? '';
    });
    if (this.assetScope.length && !this.assetScope.includes(this.activeAsset)) {
      this.activeAsset = this.assetScope[0];
    }
    if (this.assetScope.length) {
      this.setActiveAsset(this.activeAsset || this.assetScope[0]);
    }
    this.ncErrors = this.activeTemplate
      ? new Array(this.activeTemplate.questions.length).fill(false)
      : [];
  }

  private validateNcAssignment(index: number): boolean {
    if (!this.isNegativeSelection(index)) {
      this.ncErrors[index] = false;
      return true;
    }
    const assigned = this.ncAssignments[index]?.trim();
    const valid = !!assigned;
    this.ncErrors[index] = !valid;
    return valid;
  }

  private persistAnswer(index: number, status: 'Saved' | 'Submitted'): Promise<void> {
    if (!this.activeAudit || !this.activeTemplate) {
      return Promise.resolve();
    }
    const questionText = this.activeTemplate.questions[index] ?? '';
    const response = this.responseSelections[index] || null;
    const isNegative = this.isNegativeSelection(index);
    return new Promise((resolve) => {
      this.auditAnswerService
        .upsertAnswer({
          audit_code: this.activeAudit?.code ?? '',
          asset_number: this.activeAsset ? Number(this.activeAsset) : 1,
          question_index: index,
          question_text: questionText,
          response,
          response_is_negative: isNegative,
          assigned_nc: isNegative ? this.ncAssignments[index] || null : null,
          note: this.noteEntries[index] || null,
          evidence_name: this.evidenceFiles[index] || null,
          evidence_data_url: this.evidenceDataUrls[index] || null,
          evidence_urls:
            this.evidenceItems[index]
              ?.map((item) => item.key ?? this.extractEvidenceKey(item.dataUrl ?? ''))
              .filter((url): url is string => !!url) ?? null,
          status,
        })
        .subscribe({
          next: () => {
            this.savedQuestions[index] = true;
            if (this.activeAsset && this.statusByAsset[this.activeAsset]) {
              this.statusByAsset[this.activeAsset][index] = status;
            }
            resolve();
          },
          error: () => resolve(),
        });
    });
  }

  private refreshCompletionState(): void {
    const audits = this.auditPlanService.plans();
    if (!audits.length) {
      this.completedAuditCodes = new Set();
      return;
    }
    audits.forEach((audit) => {
      this.auditAnswerService.listByAuditCode(audit.code).subscribe({
        next: (answers) => {
          const totalQuestions = this.getTemplateQuestionCount(audit);
          if (!answers.length) {
            return;
          }
          const submittedByAsset = new Map<string, number>();
          const assetsSeen = new Set<string>();
          answers.forEach((answer) => {
            const asset = String(answer.assetNumber ?? 1);
            assetsSeen.add(asset);
            if (answer.status === 'Submitted') {
              submittedByAsset.set(asset, (submittedByAsset.get(asset) ?? 0) + 1);
            }
          });
          if (!assetsSeen.size) {
            return;
          }
          const allAssetsComplete = Array.from(assetsSeen).every(
            (asset) => (submittedByAsset.get(asset) ?? 0) >= totalQuestions
          );
          if (totalQuestions > 0 && allAssetsComplete) {
            this.completedAuditCodes.add(audit.code);
          }
        },
      });
    });
  }

  private markAuditSubmitted(code: string): void {
    if (!code) {
      return;
    }
    this.completedAuditCodes.add(code);
  }

  private getTemplateQuestionCount(audit: AuditPlanRecord): number {
    const template = this.resolveTemplateForAudit(audit);
    return template?.questions.length ?? 0;
  }

  private resolveTemplateForAudit(audit: AuditPlanRecord): TemplateRecord | null {
    const templates = this.templateService.templates();
    return (
      templates.find((template) => template.name === (audit.auditSubtype ?? '').trim()) ??
      templates.find((template) => template.name === audit.auditType) ??
      null
    );
  }

  private ensureAssetState(asset: string): void {
    if (!this.activeTemplate) {
      return;
    }
    const total = this.activeTemplate.questions.length;
    if (!this.responsesByAsset[asset]) {
      this.responsesByAsset[asset] = new Array(total).fill('');
    }
    if (!this.notesByAsset[asset]) {
      this.notesByAsset[asset] = new Array(total).fill('');
    }
    if (!this.ncByAsset[asset]) {
      this.ncByAsset[asset] = new Array(total).fill('');
    }
    if (!this.savedByAsset[asset]) {
      this.savedByAsset[asset] = new Array(total).fill(false);
    }
    if (!this.statusByAsset[asset]) {
      this.statusByAsset[asset] = new Array(total).fill('');
    }
    if (!this.evidenceFilesByAsset[asset]) {
      this.evidenceFilesByAsset[asset] = new Array(total).fill('');
    }
    if (!this.evidenceDataUrlsByAsset[asset]) {
      this.evidenceDataUrlsByAsset[asset] = new Array(total).fill('');
    }
    if (!this.evidenceItemsByAsset[asset]) {
      this.evidenceItemsByAsset[asset] = new Array(total).fill(null).map(() => []);
    }
  }

  private loadEvidenceForAsset(asset: string): void {
    if (!this.activeAudit || !this.activeTemplate) {
      return;
    }
    const total = this.activeTemplate.questions.length;
    for (let index = 0; index < total; index += 1) {
      const key = `audir_evidence_list_${this.activeAudit.code}_${asset}_${index}`;
      const stored = localStorage.getItem(key);
      if (!stored) {
        continue;
      }
      try {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          this.evidenceItemsByAsset[asset][index] = parsed.map((entry: any) => ({
            name: entry?.name ?? 'Evidence',
            type: entry?.type ?? 'image/png',
            key: entry?.key ?? this.extractEvidenceKey(entry?.dataUrl ?? ''),
            dataUrl: undefined,
          }));
          const firstImage = this.evidenceItemsByAsset[asset][index].find((entry) =>
            entry?.type?.startsWith?.('image/')
          );
          if (firstImage?.name) {
            this.evidenceFilesByAsset[asset][index] =
              firstImage.name || this.evidenceFilesByAsset[asset][index];
          }
          this.signEvidenceItems(this.evidenceItemsByAsset[asset][index], asset, index);
        }
      } catch {
        // ignore invalid cached evidence
      }
    }
  }

  private extractEvidenceKey(value: string): string | undefined {
    if (!value) {
      return undefined;
    }
    if (value.startsWith('http://') || value.startsWith('https://')) {
      try {
        const url = new URL(value);
        return url.pathname.replace(/^\/+/, '');
      } catch {
        return undefined;
      }
    }
    return value;
  }

  private signEvidenceItems(
    items: { name: string; type: string; key?: string; dataUrl?: string }[],
    asset: string,
    index: number
  ): void {
    const keys = items.map((item) => item.key).filter((key): key is string => !!key);
    if (!keys.length) {
      return;
    }
    if (!this.activeAudit) {
      return;
    }
    this.auditAnswerService.getEvidenceViewUrls({ keys, audit_code: this.activeAudit.code }).subscribe({
      next: (result) => {
        const urls = Array.isArray(result?.urls) ? result.urls : [];
        items.forEach((item, idx) => {
          item.dataUrl = urls[idx] ?? item.dataUrl;
        });
        const firstImage = items.find((entry) => entry?.type?.startsWith?.('image/'));
        if (firstImage?.dataUrl) {
          this.evidenceDataUrlsByAsset[asset][index] = firstImage.dataUrl;
          this.evidenceFilesByAsset[asset][index] =
            firstImage.name || this.evidenceFilesByAsset[asset][index];
        }
      },
    });
  }

  private persistEvidenceItems(
    index: number,
    items: { name: string; type: string; key?: string }[]
  ): void {
    if (!this.activeAudit) {
      return;
    }
    const key = `audir_evidence_list_${this.activeAudit.code}_${this.activeAsset}_${index}`;
    const stored = items.map((item) => ({
      name: item.name,
      type: item.type,
      key: item.key,
    }));
    localStorage.setItem(key, JSON.stringify(stored));
  }

  private getAssetScopeKey(): string {
    return this.activeAudit ? `audir_asset_scope_${this.activeAudit.code}` : 'audir_asset_scope';
  }

  private loadAssetScope(): string[] {
    if (!this.activeAudit) {
      return [];
    }
    if (typeof this.activeAudit.assetScopeCount === 'number' && this.activeAudit.assetScopeCount > 0) {
      return Array.from({ length: this.activeAudit.assetScopeCount }, (_, index) => String(index + 1));
    }
    const scope = this.activeAudit.assetScope;
    if (Array.isArray(scope) && scope.length) {
      const numeric = scope.map((value) => Number(value)).filter((value) => Number.isFinite(value));
      const max = Math.max(...numeric);
      if (max > 0) {
        return Array.from({ length: max }, (_, index) => String(index + 1));
      }
      return scope.map((value) => String(value)).filter(Boolean);
    }
    if (typeof scope === 'number' && Number.isFinite(scope) && scope > 0) {
      return Array.from({ length: scope }, (_, index) => String(index + 1));
    }
    const stored = localStorage.getItem(this.getAssetScopeKey());
    if (!stored) {
      return [];
    }
    try {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) {
        return parsed.map((item) => String(item)).filter(Boolean);
      }
    } catch {
      return [];
    }
    return [];
  }

  private persistAssetScope(): void {
    if (!this.activeAudit) {
      return;
    }
    localStorage.setItem(this.getAssetScopeKey(), JSON.stringify(this.assetScope));
  }

  private areAllAssetsSubmitted(): boolean {
    if (!this.activeTemplate) {
      return false;
    }
    const total = this.activeTemplate.questions.length;
    if (!this.assetScope.length) {
      return false;
    }
    return this.assetScope.every((asset) => {
      const statuses = this.statusByAsset[asset] ?? [];
      return statuses.filter((status) => status === 'Submitted').length >= total;
    });
  }

  private getNextIncompleteAsset(): string | null {
    if (!this.activeTemplate) {
      return null;
    }
    const total = this.activeTemplate.questions.length;
    const ordered = this.assetScope;
    for (const asset of ordered) {
      const statuses = this.statusByAsset[asset] ?? [];
      const submitted = statuses.filter((status) => status === 'Submitted').length;
      if (submitted < total) {
        return asset;
      }
    }
    return null;
  }

  private isAssignedToCurrentUser(audit: AuditPlanRecord): boolean {
    const first = this.auth.firstName().trim();
    const last = this.auth.lastName().trim();
    const fullName = `${first} ${last}`.trim().toLowerCase();
    if (!fullName) {
      return false;
    }
    return audit.auditorName.trim().toLowerCase() === fullName;
  }

  protected canPerformAudit(audit: AuditPlanRecord): boolean {
    return this.isAssignedToCurrentUser(audit);
  }

  protected async onEvidenceSelected(index: number, event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    const allowedImageTypes = new Set(['image/jpeg', 'image/png']);
    const allowedVideoTypes = new Set(['video/mp4', 'video/webm', 'video/quicktime']);
    const validFiles = files.filter(
      (file) => allowedImageTypes.has(file.type) || allowedVideoTypes.has(file.type)
    );
    if (!validFiles.length) {
      window.alert('Only JPG/PNG images and MP4/WEBM/MOV videos are allowed.');
      input.value = '';
      return;
    }

    const existingItems = this.evidenceItems[index] ?? [];
    const firstImage = validFiles.find((file) => file.type.startsWith('image/')) ?? null;
    if (!this.evidenceFiles[index]) {
      this.evidenceFiles[index] = firstImage ? firstImage.name : validFiles[0].name;
    }

    if (this.activeAudit && this.activeAsset) {
      try {
        const uploadInfo = await firstValueFrom(
          this.auditAnswerService.getEvidenceUploadUrls({
            audit_code: this.activeAudit.code,
            asset_number: Number(this.activeAsset),
            question_index: index,
            files: validFiles.map((file) => ({ name: file.name, type: file.type })),
          })
        );
        const successfulUploads: { name: string; type: string; key: string; publicUrl: string }[] = [];
        const failedUploads: string[] = [];
        for (let i = 0; i < uploadInfo.uploads.length; i += 1) {
          const upload = uploadInfo.uploads[i];
          const file = validFiles[i];
          const response = await fetch(upload.uploadUrl, {
            method: 'PUT',
            headers: { 'Content-Type': file.type || 'application/octet-stream' },
            body: file,
          });
          if (response.ok) {
            successfulUploads.push({
              name: file.name,
              type: file.type,
              key: upload.key,
              publicUrl: upload.publicUrl,
            });
          } else {
            console.error('Evidence upload failed', file.name, response.status);
            failedUploads.push(file.name);
          }
        }
        if (!successfulUploads.length) {
          window.alert('Evidence upload failed. Please try again.');
          input.value = '';
          return;
        }
        if (failedUploads.length) {
          window.alert(
            `Some files failed to upload (${failedUploads.length}). The rest were saved.`
          );
        }
        const uploadsByName = new Map(successfulUploads.map((u) => [u.name, u.publicUrl]));
        const newItems = successfulUploads.map((file) => ({
          name: file.name,
          type: file.type,
          key: file.key,
          dataUrl: file.publicUrl,
        }));
        const combined = [...existingItems, ...newItems].filter(
          (item, itemIndex, list) =>
            list.findIndex(
              (entry) => entry.name === item.name && entry.dataUrl === item.dataUrl
            ) === itemIndex
        );
        this.evidenceItems[index] = combined;
        this.signEvidenceItems(this.evidenceItems[index], this.activeAsset, index);
        const firstPublic =
          uploadsByName.get(firstImage?.name ?? '') ??
          uploadsByName.get(successfulUploads[0].name) ??
          '';
        if (!this.evidenceDataUrls[index]) {
          this.evidenceDataUrls[index] = firstPublic;
        }
        this.persistEvidenceItems(index, this.evidenceItems[index]);
        input.value = '';
        return;
      } catch (error) {
        console.error('Evidence upload failed', error);
        window.alert('Evidence upload failed. Please try again.');
      }
    }

    const imageReaders = validFiles
      .filter((file) => file.type.startsWith('image/'))
      .map(
        (file) =>
          new Promise<{ name: string; type: string; dataUrl?: string }>((resolve) => {
            const reader = new FileReader();
            reader.onload = () => {
              const dataUrl = typeof reader.result === 'string' ? reader.result : '';
              resolve({ name: file.name, type: file.type, dataUrl });
            };
            reader.readAsDataURL(file);
          })
      );

    Promise.all(imageReaders).then((images) => {
      const newItems = images.concat(
        validFiles
          .filter((file) => file.type.startsWith('video/'))
          .map((file) => ({ name: file.name, type: file.type, dataUrl: undefined }))
      );
      const combined = [...existingItems, ...newItems].filter(
        (item, itemIndex, list) =>
          list.findIndex(
            (entry) => entry.name === item.name && entry.dataUrl === item.dataUrl
          ) === itemIndex
      );
      this.evidenceItems[index] = combined;
      if (!this.evidenceDataUrls[index]) {
        this.evidenceDataUrls[index] = images[0]?.dataUrl ?? '';
      }
      if (!this.evidenceDataUrls[index] && !this.evidenceFiles[index]) {
        this.evidenceFiles[index] = validFiles[0]?.name ?? '';
      }
      this.persistEvidenceItems(index, this.evidenceItems[index]);
    });
    input.value = '';
  }

  protected countWords(value: string): number {
    const trimmed = value.trim();
    if (!trimmed) {
      return 0;
    }
    return trimmed.split(/\s+/).length;
  }

  protected async downloadQr(audit: AuditPlanRecord): Promise<void> {
    if (this.isQrGenerating[audit.id]) {
      return;
    }
    this.isQrGenerating[audit.id] = true;
    try {
      const url = `${window.location.origin}/audit-perform/${audit.code}`;
      const dataUrl = await QRCode.toDataURL(url, { margin: 1, width: 320 });
      const link = document.createElement('a');
      link.href = dataUrl;
      link.download = `audit-${audit.code}.png`;
      link.click();
    } finally {
      this.isQrGenerating[audit.id] = false;
    }
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
}
