import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { AuthState } from '../../auth-state';
import { NcRecord, NcService } from '../../services/nc.service';
import { DepartmentService } from '../../services/department.service';
import { User, UserService } from '../../services/user.service';

@Component({
  selector: 'app-nc-management',
  imports: [CommonModule, FormsModule],
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
  protected assignedFilter = '';
  protected readonly currentUserId = signal<number | null>(null);
  protected ncResponse = {
    rootCause: '',
    containmentAction: '',
    correctiveAction: '',
    preventiveAction: '',
    evidenceFile: '',
  };
  protected users: User[] = [];
  protected assignedOverrides: Record<
    string,
    { id: number; name?: string; email?: string }
  > = {};
  protected pendingAssignedNc: Record<string, string> = {};
  private usersLoaded = false;
  private usersLoading = false;
  private targetAnswerId: string | null = null;
  private targetTab: 'flagged' | 'pending' | 'closed' | null = null;

  protected readonly ncRecords = computed(() => {
    const records = this.ncService.records();
    const currentUserId = this.currentUserId();
    let department = this.auth.department().trim().toLowerCase();
    if (!department && currentUserId) {
      const currentUser = this.users.find((user) => user.id === currentUserId);
      department = String(currentUser?.department ?? '').trim().toLowerCase();
    }
    const filtered = records.filter((record) => {
      const status = (record.status || 'Assigned').toLowerCase();
      const allowed = status === 'assigned' || status === 'rework' || status === 'in progress';
      if (!allowed) {
        return false;
      }
      const assignedUserId = record.assignedUserId;
      if (assignedUserId && currentUserId && assignedUserId === currentUserId) {
        return true;
      }
      if (!department) {
        return false;
      }
      return record.assignedNc?.trim().toLowerCase() === department;
    });
    const filterValue = this.assignedFilter.trim().toLowerCase();
    if (!filterValue) {
      return filtered;
    }
    return filtered.filter((record) => record.assignedNc?.trim().toLowerCase() === filterValue);
  });

  protected readonly pendingReviewRecords = computed(() => {
    const records = this.ncService.records().filter((record) => {
      const status = (record.status || '').toLowerCase();
      return status === 'resolution submitted';
    });
    if (this.auth.role() !== 'Auditor') {
      return records;
    }
    const fullName = `${this.auth.firstName()} ${this.auth.lastName()}`.trim().toLowerCase();
    if (!fullName) {
      return [];
    }
    return records.filter(
      (record) => record.auditorName.trim().toLowerCase() === fullName
    );
  });

  protected readonly closedRecords = computed(() => {
    return this.ncService.records().filter((record) => {
      const status = (record.status || '').toLowerCase();
      return status === 'closed';
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
    this.viewRecord = null;
    this.activeRecord = record;
    this.ncResponse = {
      rootCause: record.rootCause || '',
      containmentAction: record.containmentAction || '',
      correctiveAction: record.correctiveAction || '',
      preventiveAction: record.preventiveAction || '',
      evidenceFile: record.evidenceName || '',
    };
  }

  protected closeRecord(): void {
    this.activeRecord = null;
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
    return `${day}/${month}/${year}`;
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
    if (assignedId) {
      const override = this.assignedOverrides[record.answerId];
      if (override?.email && email) {
        return override.email.trim().toLowerCase() === email;
      }
      const assignedUser = this.users.find((user) => user.id === assignedId);
      if (assignedUser?.email && email) {
        return assignedUser.email.trim().toLowerCase() === email;
      }
    }
    if (record.assignedUserEmail && email) {
      return record.assignedUserEmail.trim().toLowerCase() === email;
    }
    // If not explicitly assigned, allow any user in the assigned department.
    const recordDept = (record.assignedNc || '').trim().toLowerCase();
    if (recordDept) {
      const directDept = this.auth.department().trim().toLowerCase();
      if (directDept) {
        return recordDept === directDept;
      }
      const currentUserId = this.getCurrentUserId();
      const currentUser = this.users.find((user) => user.id === currentUserId);
      const inferredDept = String(currentUser?.department ?? '').trim().toLowerCase();
      if (inferredDept) {
        return recordDept === inferredDept;
      }
    }
    const currentUser = email
      ? this.users.find((user) => user.email.trim().toLowerCase() === email)
      : undefined;
    if (assignedId && currentUser?.id) {
      return assignedId === currentUser.id;
    }
    const currentUserId = this.getCurrentUserId();
    if (assignedId && currentUserId) {
      return assignedId === currentUserId;
    }
    if (record.assignedUserName && currentUser) {
      return (
        record.assignedUserName.trim().toLowerCase() ===
        this.userLabel(currentUser).trim().toLowerCase()
      );
    }
    return false;
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
}
