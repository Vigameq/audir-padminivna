import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import {
  ComplaintCategory,
  ComplaintEscalationStatus,
  ComplaintRecord,
  ComplaintService,
  ComplaintStatus,
  ComplaintType,
} from '../../services/complaint.service';

@Component({
  selector: 'app-complaints',
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './complaints.html',
  styleUrl: './complaints.scss',
})
export class Complaints implements OnInit {
  private readonly complaintService = inject(ComplaintService);

  protected readonly typeOptions: ComplaintType[] = ['Customer', 'Internal'];
  protected readonly categoryOptions: ComplaintCategory[] = ['Inprocess', 'Supplier'];
  protected readonly statusOptions: ComplaintStatus[] = ['Open', 'In Progress', 'Closed'];

  protected readonly activeCategory = signal<'All' | ComplaintCategory>('All');
  protected readonly activeStatus = signal<'All' | ComplaintStatus>('All');
  protected readonly activeEscalation = signal<'All' | 'Escalated' | 'Overdue'>('All');

  protected createForm = {
    complaintType: 'Internal' as ComplaintType,
    category: 'Inprocess' as ComplaintCategory,
    title: '',
    description: '',
    sourceName: '',
    reportedBy: '',
    complaintDate: '',
    assignedTo: '',
  };

  protected editDraft: Record<number, Partial<ComplaintRecord>> = {};
  protected saving = false;
  protected saveError = '';
  protected runMessage = '';

  protected readonly complaints = computed(() => {
    const category = this.activeCategory();
    const status = this.activeStatus();
    const escalation = this.activeEscalation();
    const now = Date.now();
    return this.complaintService
      .complaints()
      .filter((item) => (category === 'All' ? true : item.category === category))
      .filter((item) => (status === 'All' ? true : item.status === status))
      .filter((item) => {
        if (escalation === 'All') {
          return true;
        }
        if (escalation === 'Escalated') {
          return item.escalationLevel > 0 || item.escalationStatus === 'Escalated' || item.escalationStatus === 'Final';
        }
        if (item.status === 'Closed') {
          return false;
        }
        if (!item.targetCloseAt) {
          return false;
        }
        const dueTime = new Date(item.targetCloseAt).getTime();
        return Number.isFinite(dueTime) && dueTime < now;
      });
  });

  ngOnInit(): void {
    this.complaintService.listComplaints().subscribe();
  }

  protected setCategory(category: 'All' | ComplaintCategory): void {
    this.activeCategory.set(category);
  }

  protected setStatus(status: 'All' | ComplaintStatus): void {
    this.activeStatus.set(status);
  }

  protected setEscalation(filter: 'All' | 'Escalated' | 'Overdue'): void {
    this.activeEscalation.set(filter);
  }

  protected getEscalationLabel(record: ComplaintRecord): string {
    if (record.status === 'Closed') {
      return 'Closed';
    }
    if (record.escalationLevel > 0) {
      return `L${record.escalationLevel} ${record.escalationStatus || 'Escalated'}`;
    }
    return 'Within SLA';
  }

  protected getEscalationClass(record: ComplaintRecord): string {
    const status = (record.escalationStatus || 'None') as ComplaintEscalationStatus;
    if (record.status === 'Closed' || status === 'Closed') {
      return 'closed';
    }
    if (status === 'Final' || record.escalationLevel >= 3) {
      return 'final';
    }
    if (status === 'Escalated' || record.escalationLevel > 0) {
      return 'escalated';
    }
    return 'none';
  }

  protected getDueLabel(record: ComplaintRecord): string {
    if (!record.targetCloseAt) {
      return 'No SLA set';
    }
    const due = new Date(record.targetCloseAt).getTime();
    if (!Number.isFinite(due)) {
      return 'No SLA set';
    }
    const diffHours = Math.floor((due - Date.now()) / (1000 * 60 * 60));
    if (record.status === 'Closed') {
      return 'Closed';
    }
    if (diffHours >= 0) {
      return `Due in ${diffHours}h`;
    }
    return `Overdue by ${Math.abs(diffHours)}h`;
  }

  protected runEscalationNow(): void {
    this.runMessage = '';
    this.complaintService.runEscalation().subscribe({
      next: (result) => {
        this.runMessage = `${result.escalated} escalated out of ${result.scanned} open complaints.`;
        this.complaintService.listComplaints().subscribe();
      },
      error: () => {
        this.runMessage = 'Unable to run escalation now.';
      },
    });
  }

  protected createComplaint(): void {
    const title = this.createForm.title.trim();
    if (!title || this.saving) {
      return;
    }
    this.saving = true;
    this.saveError = '';
    this.complaintService
      .createComplaint({
        complaint_type: this.createForm.complaintType,
        category: this.createForm.category,
        title,
        description: this.createForm.description.trim() || null,
        source_name: this.createForm.sourceName.trim() || null,
        reported_by: this.createForm.reportedBy.trim() || null,
        complaint_date: this.createForm.complaintDate || null,
        assigned_to: this.createForm.assignedTo.trim() || null,
      })
      .subscribe({
        next: () => {
          this.createForm = {
            complaintType: 'Internal',
            category: 'Inprocess',
            title: '',
            description: '',
            sourceName: '',
            reportedBy: '',
            complaintDate: '',
            assignedTo: '',
          };
          this.saving = false;
        },
        error: () => {
          this.saving = false;
          this.saveError = 'Unable to create complaint. Please try again.';
        },
      });
  }

  protected startEdit(record: ComplaintRecord): void {
    this.editDraft[record.id] = {
      status: record.status,
      assignedTo: record.assignedTo,
      resolution: record.resolution,
    };
  }

  protected cancelEdit(id: number): void {
    delete this.editDraft[id];
  }

  protected hasEditDraft(id: number): boolean {
    return !!this.editDraft[id];
  }

  protected saveComplaint(record: ComplaintRecord): void {
    const draft = this.editDraft[record.id];
    if (!draft) {
      return;
    }
    this.complaintService
      .updateComplaint(record.id, {
        status: (draft.status as ComplaintStatus) ?? record.status,
        assigned_to: (draft.assignedTo ?? record.assignedTo ?? '').trim() || null,
        resolution: (draft.resolution ?? record.resolution ?? '').trim() || null,
      })
      .subscribe({
        next: () => {
          delete this.editDraft[record.id];
        },
      });
  }

  protected patchDraft(id: number, key: keyof ComplaintRecord, value: unknown): void {
    this.editDraft[id] = {
      ...(this.editDraft[id] ?? {}),
      [key]: value,
    };
  }
}
