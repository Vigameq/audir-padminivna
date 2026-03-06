import { CommonModule } from '@angular/common';
import { Component, HostListener, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { AuthState } from '../../auth-state';
import { NcRecord, NcService } from '../../services/nc.service';
import { DepartmentService } from '../../services/department.service';
import { User, UserService } from '../../services/user.service';

@Component({
  selector: 'app-nc-management',
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './nc-management.html',
  styleUrl: './nc-management.scss',
})
export class NcManagement implements OnInit {
  protected readonly auth = inject(AuthState);
  private readonly ncService = inject(NcService);
  private readonly userService = inject(UserService);
  private readonly departmentService = inject(DepartmentService);
  private readonly route = inject(ActivatedRoute);
  protected activeRecord: NcRecord | null = null;
  protected viewRecord: NcRecord | null = null;
  protected activeTab: 'flagged' | 'pending' | 'closed' = 'flagged';
  protected searchQuery = '';
  protected readonly currentUserId = signal<number | null>(null);
  protected ncResponse = {
    rootCause: '',
    containmentAction: '',
    correctiveAction: '',
    preventiveAction: '',
    evidenceFile: '',
    gdSummary: '',
    fishboneData: this.createEmptyFishbone(),
    whyWhyData: this.createEmptyWhyWhy(),
  };
  protected readonly whyWhySteps = [1, 2, 3, 4, 5];
  protected users: User[] = [];
  protected assignedOverrides: Record<
    string,
    { id: number; name?: string; email?: string }
  > = {};
  protected pendingAssignedNc: Record<string, string> = {};
  protected openActionMenuFor: string | null = null;
  protected rejectRecord: NcRecord | null = null;
  protected rejectReason = '';
  protected rejectSubmitting = false;
  private usersLoaded = false;
  private usersLoading = false;
  private targetAnswerId: string | null = null;
  private targetTab: 'flagged' | 'pending' | 'closed' | null = null;

  protected readonly ncRecords = computed(() => {
    const records = this.visibleDepartmentRecords();
    return records.filter((record) => {
      const status = (record.status || 'Assigned').toLowerCase();
      const allowed = status === 'assigned' || status === 'rework' || status === 'in progress';
      if (!allowed) {
        return false;
      }
      return this.matchesSearch(record);
    });
  });

  protected readonly pendingReviewRecords = computed(() => {
    const records = this.visibleDepartmentRecords().filter((record) => {
      const status = (record.status || '').toLowerCase();
      return status === 'resolution submitted' && this.matchesSearch(record);
    });
    return records;
  });

  protected readonly closedRecords = computed(() => {
    return this.visibleDepartmentRecords().filter((record) => {
      const status = (record.status || '').toLowerCase();
      return status === 'closed' && this.matchesSearch(record);
    });
  });

  ngOnInit(): void {
    this.ncService.listRecords().subscribe({
      next: () => this.applyDeepLink(),
    });
    this.loadUsers();
    this.departmentService.migrateFromLocal().subscribe();
    this.route.queryParamMap.subscribe((params) => {
      const tab = params.get('tab');
      const answerId = params.get('answerId');
      this.targetTab = tab === 'pending' || tab === 'flagged' || tab === 'closed' ? tab : null;
      this.targetAnswerId = answerId;
      if (this.targetTab) {
        this.activeTab = this.targetTab;
      }
      this.applyDeepLink();
    });
  }

  protected get departments(): string[] {
    return this.departmentService.departments();
  }

  protected updateAssignedNc(record: NcRecord, value: string): void {
    this.pendingAssignedNc[record.answerId] = value.trim();
  }

  protected confirmAssignedNc(record: NcRecord): void {
    const next = this.pendingAssignedNc[record.answerId];
    if (!next) {
      return;
    }
    const confirmed = window.confirm(`Assign NC to ${next}?`);
    if (!confirmed) {
      return;
    }
    this.ncService.updateAssignedNc(record.answerId, next).subscribe({
      next: () => {
        record.assignedNc = next;
        record.assignedUserId = undefined;
        record.assignedUserName = undefined;
        record.assignedUserEmail = undefined;
        delete this.assignedOverrides[record.answerId];
        delete this.pendingAssignedNc[record.answerId];
        this.ncService.listRecords().subscribe();
      },
    });
  }

  protected isAssignedNcPending(record: NcRecord): boolean {
    const pending = this.pendingAssignedNc[record.answerId] ?? '';
    const current = record.assignedNc ?? '';
    return pending.trim() !== '' && pending.trim() !== current.trim();
  }

  protected openRecord(record: NcRecord): void {
    this.openActionMenuFor = null;
    this.viewRecord = null;
    this.activeRecord = record;
    this.ncResponse = {
      rootCause: record.rootCause || '',
      containmentAction: record.containmentAction || '',
      correctiveAction: record.correctiveAction || '',
      preventiveAction: record.preventiveAction || '',
      evidenceFile: record.evidenceName || '',
      gdSummary: record.gdSummary || '',
      fishboneData: {
        ...this.createEmptyFishbone(),
        ...(record.fishboneData ?? {}),
      },
      whyWhyData: this.mergeWhyWhy(record.whyWhyData ?? []),
    };
  }

  protected closeRecord(): void {
    this.activeRecord = null;
  }

  protected toggleActionMenu(record: NcRecord): void {
    this.openActionMenuFor =
      this.openActionMenuFor === record.answerId ? null : record.answerId;
  }

  protected isActionMenuOpen(record: NcRecord): boolean {
    return this.openActionMenuFor === record.answerId;
  }

  protected chooseAction(record: NcRecord, action: 'perform' | 'reject'): void {
    this.openActionMenuFor = null;
    if (action === 'perform') {
      this.openRecord(record);
      return;
    }
    this.openRejectModal(record);
  }

  @HostListener('document:click', ['$event'])
  protected onDocumentClick(event: MouseEvent): void {
    if (!this.openActionMenuFor) {
      return;
    }
    const target = event.target as HTMLElement | null;
    if (target?.closest('.action-menu')) {
      return;
    }
    this.openActionMenuFor = null;
  }

  @HostListener('document:keydown.escape')
  protected onEscape(): void {
    this.openActionMenuFor = null;
  }

  protected openRejectModal(record: NcRecord): void {
    this.rejectRecord = record;
    this.rejectReason = '';
  }

  protected closeRejectModal(): void {
    this.rejectRecord = null;
    this.rejectReason = '';
    this.rejectSubmitting = false;
  }

  protected submitReject(): void {
    if (!this.rejectRecord || this.rejectSubmitting) {
      return;
    }
    const reason = this.rejectReason.trim();
    if (!reason) {
      window.alert('Please provide a reject reason.');
      return;
    }
    this.rejectSubmitting = true;
    this.ncService
      .upsertAction({
        answer_id: this.rejectRecord.answerId,
        root_cause: this.rejectRecord.rootCause || null,
        containment_action: this.rejectRecord.containmentAction || null,
        corrective_action: this.rejectRecord.correctiveAction || null,
        preventive_action: this.rejectRecord.preventiveAction || null,
        evidence_name: this.rejectRecord.evidenceName || null,
        gd_summary: reason,
        fishbone_data: this.rejectRecord.fishboneData ?? this.createEmptyFishbone(),
        why_why_data: this.mergeWhyWhy(this.rejectRecord.whyWhyData ?? []),
        assigned_user_id: null,
        status: 'Rework',
      })
      .subscribe({
        next: () => {
          this.closeRejectModal();
          this.ncService.listRecords().subscribe();
        },
        error: (error) => {
          const detail = String(error?.error?.detail ?? 'Unable to reject NC. Please try again.');
          window.alert(detail);
          this.rejectSubmitting = false;
        },
      });
  }

  protected openReview(record: NcRecord): void {
    this.activeRecord = null;
    this.viewRecord = record;
  }

  protected closeReview(): void {
    this.viewRecord = null;
  }

  protected openClosed(record: NcRecord): void {
    this.activeRecord = null;
    this.viewRecord = record;
  }

  protected onEvidenceSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    this.ncResponse.evidenceFile = file ? file.name : '';
    input.value = '';
  }

  protected submitNc(): void {
    if (!this.activeRecord) {
      return;
    }
    const confirmed = window.confirm('Are you sure you want to submit this NC?');
    if (!confirmed) {
      return;
    }
    this.ncService
      .upsertAction({
        answer_id: this.activeRecord.answerId,
        root_cause: this.ncResponse.rootCause || null,
        containment_action: this.ncResponse.containmentAction || null,
        corrective_action: this.ncResponse.correctiveAction || null,
        preventive_action: this.ncResponse.preventiveAction || null,
        evidence_name: this.ncResponse.evidenceFile || null,
        gd_summary: this.ncResponse.gdSummary.trim() || null,
        fishbone_data: this.toFishbonePayload(),
        why_why_data: this.toWhyWhyPayload(),
        status: 'Resolution Submitted',
      })
      .subscribe({
        next: () => {
          this.closeRecord();
          this.ncService.listRecords().subscribe();
        },
      });
  }

  protected saveNc(): void {
    if (!this.activeRecord) {
      return;
    }
    this.ncService
      .upsertAction({
        answer_id: this.activeRecord.answerId,
        root_cause: this.ncResponse.rootCause || null,
        containment_action: this.ncResponse.containmentAction || null,
        corrective_action: this.ncResponse.correctiveAction || null,
        preventive_action: this.ncResponse.preventiveAction || null,
        evidence_name: this.ncResponse.evidenceFile || null,
        gd_summary: this.ncResponse.gdSummary.trim() || null,
        fishbone_data: this.toFishbonePayload(),
        why_why_data: this.toWhyWhyPayload(),
        status: 'In Progress',
      })
      .subscribe({
        next: () => {
          this.closeRecord();
          this.ncService.listRecords().subscribe();
        },
      });
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
    return `${day}-${month}-${year}`;
  }

  protected getAssignedUserLabel(record: NcRecord): string {
    const override = this.assignedOverrides[record.answerId];
    if (override?.name) {
      return override.name;
    }
    if (override?.email) {
      return override.email;
    }
    if (record.assignedUserName) {
      return record.assignedUserName;
    }
    if (record.assignedUserEmail) {
      return record.assignedUserEmail;
    }
    if (record.assignedUserId) {
      return 'Assigned';
    }
    return 'Unassigned';
  }

  protected canPerformNc(record: NcRecord): boolean {
    const assignedId = this.getAssignedUserId(record);
    const email = this.auth.email().trim().toLowerCase();
    const currentName = `${this.auth.firstName()} ${this.auth.lastName()}`
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ');
    const tokenUserId = this.getTokenUserId();
    const assignedLabel = this.getAssignedUserLabel(record)
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ');

    if (assignedLabel && ((currentName && assignedLabel === currentName) || (email && assignedLabel === email))) {
      return true;
    }

    if (!assignedId && !record.assignedUserEmail && !record.assignedUserName) {
      return false;
    }

    if (assignedId) {
      const override = this.assignedOverrides[record.answerId];
      if (override?.email && email) {
        return override.email.trim().toLowerCase() === email;
      }
      const currentUserId = this.getCurrentUserId();
      if (currentUserId) {
        return assignedId === currentUserId;
      }
      if (tokenUserId) {
        return assignedId === tokenUserId;
      }
      const assignedUser = this.users.find((user) => user.id === assignedId);
      if (assignedUser?.email && email) {
        return assignedUser.email.trim().toLowerCase() === email;
      }
      if (assignedUser && currentName) {
        const assignedName = this.userLabel(assignedUser)
          .trim()
          .toLowerCase()
          .replace(/\s+/g, ' ');
        if (assignedName === currentName) {
          return true;
        }
      }
      if (record.assignedUserName && currentName) {
        const recordName = record.assignedUserName
          .trim()
          .toLowerCase()
          .replace(/\s+/g, ' ');
        if (recordName === currentName) {
          return true;
        }
      }
      if (record.assignedUserEmail && email) {
        return record.assignedUserEmail.trim().toLowerCase() === email;
      }
      return false;
    }

    if (record.assignedUserEmail && email) {
      return record.assignedUserEmail.trim().toLowerCase() === email;
    }
    if (record.assignedUserName && currentName) {
      const recordName = record.assignedUserName
        .trim()
        .toLowerCase()
        .replace(/\s+/g, ' ');
      if (recordName === currentName) {
        return true;
      }
    }

    const currentUser = email
      ? this.users.find((user) => user.email.trim().toLowerCase() === email)
      : undefined;
    if (record.assignedUserName && currentUser) {
      return (
        record.assignedUserName.trim().toLowerCase() ===
        this.userLabel(currentUser).trim().toLowerCase()
      );
    }
    return false;
  }

  private getTokenUserId(): number | null {
    const token = this.auth.accessToken();
    if (!token) {
      return null;
    }
    const parts = token.split('.');
    if (parts.length < 2) {
      return null;
    }
    try {
      const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
      const payloadText = atob(padded);
      const payload = JSON.parse(payloadText) as { sub?: string | number };
      const parsed = Number(payload?.sub);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    } catch {
      return null;
    }
  }

  private matchesSearch(record: NcRecord): boolean {
    const query = this.searchQuery.trim().toLowerCase();
    if (!query) {
      return true;
    }
    const haystack = [
      record.auditCode,
      record.auditType,
      record.auditSubtype,
      record.question,
    ]
      .map((value) => String(value ?? '').toLowerCase())
      .join(' ');
    return haystack.includes(query);
  }

  private visibleDepartmentRecords(): NcRecord[] {
    const department = this.currentDepartment();
    return this.ncService.records().filter((record) => {
      const hasAssignedUser =
        !!this.getAssignedUserId(record) ||
        !!String(record.assignedUserEmail ?? '').trim() ||
        !!String(record.assignedUserName ?? '').trim();
      if (hasAssignedUser) {
        return this.canPerformNc(record);
      }
      if (!department) {
        return true;
      }
      const assignedDepartment = String(record.assignedNc ?? '').trim().toLowerCase();
      return !!assignedDepartment && assignedDepartment === department;
    });
  }

  private currentDepartment(): string {
    const authDepartment = this.auth.department().trim().toLowerCase();
    if (authDepartment) {
      return authDepartment;
    }
    const email = this.auth.email().trim().toLowerCase();
    if (!email) {
      return '';
    }
    const currentUser = this.users.find(
      (user) => String(user.email ?? '').trim().toLowerCase() === email
    );
    return String(currentUser?.department ?? '').trim().toLowerCase();
  }

  protected setTab(tab: 'flagged' | 'pending' | 'closed'): void {
    this.activeTab = tab;
  }

  private getCurrentUserId(): number | null {
    const existing = this.currentUserId();
    if (existing) {
      return existing;
    }
    const email = this.auth.email().trim().toLowerCase();
    if (!email) {
      return null;
    }
    const match = this.users.find((user) => user.email.toLowerCase() === email);
    if (match?.id) {
      this.currentUserId.set(match.id);
      return match.id;
    }
    return null;
  }

  protected usersForDepartment(department: string): User[] {
    const target = String(department ?? '').trim().toLowerCase();
    if (!target) {
      return [];
    }
    if (!this.usersLoaded && !this.usersLoading) {
      this.loadUsers();
    }
    return this.users.filter((user) => {
      const userDepartment = String(user.department ?? '').trim().toLowerCase();
      const status = String(user.status ?? '').trim().toLowerCase();
      return userDepartment === target && status === 'active';
    });
  }

  protected userLabel(user: User): string {
    const name = `${user.first_name ?? ''} ${user.last_name ?? ''}`.trim();
    return name || user.email;
  }

  protected assignUser(record: NcRecord, value: string | number): void {
    if (this.getAssignedUserId(record) && this.auth.role() !== 'Manager') {
      return;
    }
    const selectedId = Number(value);
    if (!selectedId) {
      return;
    }
    const selectedUser = this.users.find((user) => user.id === selectedId);
    const label = selectedUser ? this.userLabel(selectedUser) : 'this user';
    const confirmed = window.confirm(`Are you sure to assign this NC to ${label}?`);
    if (!confirmed) {
      return;
    }
    this.assignedOverrides[record.answerId] = {
      id: selectedId,
      name: selectedUser ? this.userLabel(selectedUser) : undefined,
      email: selectedUser?.email,
    };
    this.ncService.assignUser(record.answerId, selectedId, 'Assigned').subscribe({
      next: () => {
        this.ncService.listRecords().subscribe();
      },
    });
  }

  protected approveNc(record: NcRecord): void {
    const confirmed = window.confirm('Are you sure you want to close this NC?');
    if (!confirmed) {
      return;
    }
    this.ncService
      .upsertAction({
        answer_id: record.answerId,
        root_cause: record.rootCause || null,
        containment_action: record.containmentAction || null,
        corrective_action: record.correctiveAction || null,
        preventive_action: record.preventiveAction || null,
        evidence_name: record.evidenceName || null,
        gd_summary: record.gdSummary || null,
        fishbone_data: record.fishboneData ?? this.createEmptyFishbone(),
        why_why_data: this.mergeWhyWhy(record.whyWhyData ?? []),
        status: 'Closed',
      })
      .subscribe({
        next: () => this.ncService.listRecords().subscribe(),
      });
  }

  protected requestRework(record: NcRecord): void {
    const confirmed = window.confirm('Are you sure you want to request rework?');
    if (!confirmed) {
      return;
    }
    const assignedUserId = this.getAssignedUserId(record);
    this.ncService
      .upsertAction({
        answer_id: record.answerId,
        root_cause: record.rootCause || null,
        containment_action: record.containmentAction || null,
        corrective_action: record.correctiveAction || null,
        preventive_action: record.preventiveAction || null,
        evidence_name: record.evidenceName || null,
        gd_summary: record.gdSummary || null,
        fishbone_data: record.fishboneData ?? this.createEmptyFishbone(),
        why_why_data: this.mergeWhyWhy(record.whyWhyData ?? []),
        assigned_user_id: assignedUserId ?? null,
        status: 'Rework',
      })
      .subscribe({
        next: () => this.ncService.listRecords().subscribe(),
      });
  }

  private loadUsers(): void {
    if (this.usersLoading) {
      return;
    }
    this.usersLoading = true;
    this.userService.listUsers().subscribe({
      next: (users) => {
        this.users = users;
        this.usersLoaded = true;
        const email = this.auth.email().trim().toLowerCase();
        const current = email
          ? users.find((user) => user.email.toLowerCase() === email)
          : undefined;
        this.currentUserId.set(current?.id ?? null);
      },
      error: () => {
        this.usersLoaded = false;
        this.usersLoading = false;
      },
      complete: () => {
        this.usersLoading = false;
      },
    });
  }

  protected getAssignedUserId(record: NcRecord): number | null {
    const override = this.assignedOverrides[record.answerId];
    if (override?.id) {
      return override.id;
    }
    if (record.assignedUserId) {
      return record.assignedUserId;
    }
    return null;
  }

  protected canAssignUser(record: NcRecord): boolean {
    const recordDept = (record.assignedNc || '').trim().toLowerCase();
    if (!recordDept) {
      return false;
    }
    let department = this.auth.department().trim().toLowerCase();
    if (department) {
      return recordDept === department;
    }
    const currentId = this.currentUserId();
    const currentUser = this.users.find((user) => user.id === currentId);
    const inferred = String(currentUser?.department ?? '').trim().toLowerCase();
    if (inferred) {
      return recordDept === inferred;
    }
    // If we don't have user info yet, keep the dropdown enabled.
    return true;
  }

  protected hasAssignedUserOption(record: NcRecord): boolean {
    const assignedId = this.getAssignedUserId(record);
    if (!assignedId) {
      return false;
    }
    return this.usersForDepartment(record.assignedNc).some(
      (user) => user.id === assignedId
    );
  }

  private applyDeepLink(): void {
    if (!this.targetAnswerId) {
      return;
    }
    const match = this.ncService
      .records()
      .find((record) => String(record.answerId) === String(this.targetAnswerId));
    if (!match) {
      return;
    }
    if (this.targetTab === 'pending' || this.targetTab === 'closed') {
      this.openReview(match);
    } else {
      this.openRecord(match);
    }
    this.targetAnswerId = null;
  }

  protected whyWhyValue(index: number): string {
    return this.ncResponse.whyWhyData[index] ?? '';
  }

  protected onWhyWhyChange(index: number, value: string): void {
    const next = this.mergeWhyWhy(this.ncResponse.whyWhyData);
    next[index] = value;
    this.ncResponse.whyWhyData = next;
  }

  private createEmptyFishbone(): {
    man: string;
    machine: string;
    method: string;
    material: string;
    measurement: string;
    environment: string;
  } {
    return {
      man: '',
      machine: '',
      method: '',
      material: '',
      measurement: '',
      environment: '',
    };
  }

  private createEmptyWhyWhy(): string[] {
    return ['', '', '', '', ''];
  }

  private mergeWhyWhy(input: string[]): string[] {
    const next = this.createEmptyWhyWhy();
    input.slice(0, 5).forEach((value, index) => {
      next[index] = String(value ?? '');
    });
    return next;
  }

  private toFishbonePayload(): Record<string, string> {
    return {
      man: this.ncResponse.fishboneData.man.trim(),
      machine: this.ncResponse.fishboneData.machine.trim(),
      method: this.ncResponse.fishboneData.method.trim(),
      material: this.ncResponse.fishboneData.material.trim(),
      measurement: this.ncResponse.fishboneData.measurement.trim(),
      environment: this.ncResponse.fishboneData.environment.trim(),
    };
  }

  private toWhyWhyPayload(): string[] {
    return this.mergeWhyWhy(this.ncResponse.whyWhyData).map((value) => value.trim());
  }
}
