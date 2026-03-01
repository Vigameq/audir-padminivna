import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  CalibrationResult,
  InstrumentCalibrationRecord,
  InstrumentRecord,
  InstrumentService,
  InstrumentStatus,
} from '../../services/instrument.service';

@Component({
  selector: 'app-instruments',
  imports: [CommonModule, FormsModule],
  templateUrl: './instruments.html',
  styleUrl: './instruments.scss',
})
export class Instruments implements OnInit {
  private readonly instrumentService = inject(InstrumentService);

  protected readonly statusOptions: InstrumentStatus[] = ['Active', 'Inactive', 'Out of Service'];
  protected readonly calibrationResultOptions: CalibrationResult[] = ['Pass', 'Fail', 'Conditional'];
  protected readonly activeStatus = signal<'All' | InstrumentStatus>('All');
  protected readonly dueFilter = signal<'All' | 'Overdue' | 'DueSoon'>('All');

  protected createForm = {
    name: '',
    instrumentType: '',
    serialNumber: '',
    location: '',
    ownerDepartment: '',
    calibrationFrequencyDays: 180,
    lastCalibratedAt: '',
    status: 'Active' as InstrumentStatus,
    remarks: '',
  };

  protected selectedInstrument: InstrumentRecord | null = null;
  protected calibrationForm = {
    calibrationDate: '',
    calibratedBy: '',
    result: 'Pass' as CalibrationResult,
    certificateNo: '',
    notes: '',
  };
  protected calibrationHistory: InstrumentCalibrationRecord[] = [];
  protected loadingHistory = false;

  protected editDraft: Record<number, Partial<InstrumentRecord>> = {};
  protected saving = false;
  protected saveError = '';

  protected readonly instruments = computed(() => {
    const status = this.activeStatus();
    const dueFilter = this.dueFilter();
    const now = Date.now();
    const soonLimit = now + 7 * 24 * 60 * 60 * 1000;
    return this.instrumentService
      .instruments()
      .filter((item) => (status === 'All' ? true : item.status === status))
      .filter((item) => {
        if (dueFilter === 'All') {
          return true;
        }
        const due = new Date(item.nextCalibrationDue).getTime();
        if (!Number.isFinite(due)) {
          return false;
        }
        if (dueFilter === 'Overdue') {
          return due < now;
        }
        return due >= now && due <= soonLimit;
      });
  });

  ngOnInit(): void {
    this.instrumentService.listInstruments().subscribe();
  }

  protected setStatus(status: 'All' | InstrumentStatus): void {
    this.activeStatus.set(status);
  }

  protected setDueFilter(filter: 'All' | 'Overdue' | 'DueSoon'): void {
    this.dueFilter.set(filter);
  }

  protected createInstrument(): void {
    const name = this.createForm.name.trim();
    if (!name || this.saving) {
      return;
    }
    this.saving = true;
    this.saveError = '';
    this.instrumentService
      .createInstrument({
        name,
        instrument_type: this.createForm.instrumentType.trim() || null,
        serial_number: this.createForm.serialNumber.trim() || null,
        location: this.createForm.location.trim() || null,
        owner_department: this.createForm.ownerDepartment.trim() || null,
        calibration_frequency_days: Number(this.createForm.calibrationFrequencyDays) || 180,
        last_calibrated_at: this.createForm.lastCalibratedAt || null,
        status: this.createForm.status,
        remarks: this.createForm.remarks.trim() || null,
      })
      .subscribe({
        next: () => {
          this.createForm = {
            name: '',
            instrumentType: '',
            serialNumber: '',
            location: '',
            ownerDepartment: '',
            calibrationFrequencyDays: 180,
            lastCalibratedAt: '',
            status: 'Active',
            remarks: '',
          };
          this.saving = false;
        },
        error: () => {
          this.saving = false;
          this.saveError = 'Unable to create instrument. Please try again.';
        },
      });
  }

  protected startEdit(record: InstrumentRecord): void {
    this.editDraft[record.id] = {
      status: record.status,
      calibrationFrequencyDays: record.calibrationFrequencyDays,
      nextCalibrationDue: record.nextCalibrationDue,
      remarks: record.remarks,
    };
  }

  protected cancelEdit(id: number): void {
    delete this.editDraft[id];
  }

  protected hasEditDraft(id: number): boolean {
    return !!this.editDraft[id];
  }

  protected saveInstrument(record: InstrumentRecord): void {
    const draft = this.editDraft[record.id];
    if (!draft) {
      return;
    }
    this.instrumentService
      .updateInstrument(record.id, {
        status: (draft.status as InstrumentStatus) ?? record.status,
        calibration_frequency_days:
          Number(draft.calibrationFrequencyDays ?? record.calibrationFrequencyDays) || 180,
        next_calibration_due: (draft.nextCalibrationDue ?? record.nextCalibrationDue ?? '').trim() || null,
        remarks: (draft.remarks ?? record.remarks ?? '').trim() || null,
      })
      .subscribe({
        next: () => {
          delete this.editDraft[record.id];
        },
      });
  }

  protected patchDraft(id: number, key: keyof InstrumentRecord, value: unknown): void {
    this.editDraft[id] = {
      ...(this.editDraft[id] ?? {}),
      [key]: value,
    };
  }

  protected openCalibration(record: InstrumentRecord): void {
    this.selectedInstrument = record;
    this.calibrationForm = {
      calibrationDate: '',
      calibratedBy: '',
      result: 'Pass',
      certificateNo: '',
      notes: '',
    };
    this.loadingHistory = true;
    this.instrumentService.listCalibrations(record.id).subscribe({
      next: (rows) => {
        this.calibrationHistory = rows;
        this.loadingHistory = false;
      },
      error: () => {
        this.calibrationHistory = [];
        this.loadingHistory = false;
      },
    });
  }

  protected closeCalibration(): void {
    this.selectedInstrument = null;
    this.calibrationHistory = [];
  }

  protected saveCalibration(): void {
    if (!this.selectedInstrument) {
      return;
    }
    if (!this.calibrationForm.calibrationDate) {
      return;
    }
    this.instrumentService
      .addCalibration(this.selectedInstrument.id, {
        calibration_date: this.calibrationForm.calibrationDate,
        calibrated_by: this.calibrationForm.calibratedBy.trim() || null,
        result: this.calibrationForm.result,
        certificate_no: this.calibrationForm.certificateNo.trim() || null,
        notes: this.calibrationForm.notes.trim() || null,
      })
      .subscribe({
        next: (record) => {
          this.calibrationHistory = [record, ...this.calibrationHistory];
          this.instrumentService.listInstruments().subscribe();
          this.calibrationForm = {
            calibrationDate: '',
            calibratedBy: '',
            result: 'Pass',
            certificateNo: '',
            notes: '',
          };
        },
      });
  }

  protected dueLabel(record: InstrumentRecord): string {
    if (!record.nextCalibrationDue) {
      return 'No due date';
    }
    const due = new Date(record.nextCalibrationDue).getTime();
    if (!Number.isFinite(due)) {
      return 'No due date';
    }
    const diffDays = Math.floor((due - Date.now()) / (1000 * 60 * 60 * 24));
    if (diffDays < 0) {
      return `Overdue by ${Math.abs(diffDays)}d`;
    }
    return `Due in ${diffDays}d`;
  }
}
