import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import {
  ChangeRecord,
  ChangeRequestType,
  ChangeRiskLevel,
  ChangeService,
  ChangeStatus,
  FourMCategory,
} from '../../services/change.service';

@Component({
  selector: 'app-change-management',
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './change-management.html',
  styleUrl: './change-management.scss',
})
export class ChangeManagement implements OnInit {
  private readonly changeService = inject(ChangeService);

  protected readonly typeOptions: ChangeRequestType[] = ['ECR', 'ECN'];
  protected readonly fourMOptions: FourMCategory[] = ['Man', 'Machine', 'Method', 'Material'];
  protected readonly riskOptions: ChangeRiskLevel[] = ['Low', 'Medium', 'High', 'Critical'];
  protected readonly statusOptions: ChangeStatus[] = [
    'Draft',
    'Open',
    'In Review',
    'Approved',
    'Implemented',
    'Rejected',
    'Closed',
  ];

  protected readonly activeType = signal<'All' | ChangeRequestType>('All');
  protected readonly activeStatus = signal<'All' | ChangeStatus>('All');
  protected readonly activeFourM = signal<'All' | FourMCategory>('All');

  protected createForm = {
    requestType: 'ECR' as ChangeRequestType,
    title: '',
    description: '',
    fourMCategory: 'Method' as FourMCategory,
    changeReason: '',
    impactAssessment: '',
    riskLevel: 'Medium' as ChangeRiskLevel,
    status: 'Open' as ChangeStatus,
    requestedBy: '',
    requestedDate: '',
    targetDate: '',
    approvedBy: '',
  };

  protected editDraft: Record<number, Partial<ChangeRecord>> = {};
  protected saving = false;
  protected saveError = '';

  protected readonly changes = computed(() => {
    const type = this.activeType();
    const status = this.activeStatus();
    const fourM = this.activeFourM();
    return this.changeService
      .changes()
      .filter((item) => (type === 'All' ? true : item.requestType === type))
      .filter((item) => (status === 'All' ? true : item.status === status))
      .filter((item) => (fourM === 'All' ? true : item.fourMCategory === fourM));
  });

  ngOnInit(): void {
    this.changeService.listChanges().subscribe();
  }

  protected setType(value: 'All' | ChangeRequestType): void {
    this.activeType.set(value);
  }

  protected setStatus(value: 'All' | ChangeStatus): void {
    this.activeStatus.set(value);
  }

  protected setFourM(value: 'All' | FourMCategory): void {
    this.activeFourM.set(value);
  }

  protected createChange(): void {
    const title = this.createForm.title.trim();
    if (!title || this.saving) {
      return;
    }
    this.saving = true;
    this.saveError = '';
    this.changeService
      .createChange({
        request_type: this.createForm.requestType,
        title,
        description: this.createForm.description.trim() || null,
        four_m_category: this.createForm.fourMCategory,
        change_reason: this.createForm.changeReason.trim() || null,
        impact_assessment: this.createForm.impactAssessment.trim() || null,
        risk_level: this.createForm.riskLevel,
        status: this.createForm.status,
        requested_by: this.createForm.requestedBy.trim() || null,
        requested_date: this.createForm.requestedDate || null,
        target_date: this.createForm.targetDate || null,
        approved_by: this.createForm.approvedBy.trim() || null,
      })
      .subscribe({
        next: () => {
          this.createForm = {
            requestType: 'ECR',
            title: '',
            description: '',
            fourMCategory: 'Method',
            changeReason: '',
            impactAssessment: '',
            riskLevel: 'Medium',
            status: 'Open',
            requestedBy: '',
            requestedDate: '',
            targetDate: '',
            approvedBy: '',
          };
          this.saving = false;
        },
        error: () => {
          this.saving = false;
          this.saveError = 'Unable to create change request. Please try again.';
        },
      });
  }

  protected startEdit(record: ChangeRecord): void {
    this.editDraft[record.id] = {
      status: record.status,
      riskLevel: record.riskLevel,
      approvedBy: record.approvedBy,
      targetDate: record.targetDate,
    };
  }

  protected cancelEdit(id: number): void {
    delete this.editDraft[id];
  }

  protected hasEditDraft(id: number): boolean {
    return !!this.editDraft[id];
  }

  protected saveChange(record: ChangeRecord): void {
    const draft = this.editDraft[record.id];
    if (!draft) {
      return;
    }
    this.changeService
      .updateChange(record.id, {
        status: (draft.status as ChangeStatus) ?? record.status,
        risk_level: (draft.riskLevel as ChangeRiskLevel) ?? record.riskLevel,
        approved_by: (draft.approvedBy ?? record.approvedBy ?? '').trim() || null,
        target_date: (draft.targetDate ?? record.targetDate ?? '').trim() || null,
      })
      .subscribe({
        next: () => {
          delete this.editDraft[record.id];
        },
      });
  }

  protected patchDraft(id: number, key: keyof ChangeRecord, value: unknown): void {
    this.editDraft[id] = {
      ...(this.editDraft[id] ?? {}),
      [key]: value,
    };
  }
}
