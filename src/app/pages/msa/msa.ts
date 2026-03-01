import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { forkJoin } from 'rxjs';
import { InstrumentService } from '../../services/instrument.service';
import {
  MsaAction,
  MsaActionStatus,
  MsaMeasurement,
  MsaResult,
  MsaService,
  MsaStudy,
  MsaStudyStatus,
  MsaStudyType,
} from '../../services/msa.service';

@Component({
  selector: 'app-msa',
  imports: [CommonModule, FormsModule],
  templateUrl: './msa.html',
  styleUrl: './msa.scss',
})
export class Msa implements OnInit {
  private readonly msaService = inject(MsaService);
  private readonly instrumentService = inject(InstrumentService);

  protected readonly studyTypeOptions: MsaStudyType[] = ['GRR', 'Bias', 'Linearity', 'Stability'];
  protected readonly studyStatusOptions: MsaStudyStatus[] = [
    'Draft',
    'Data Collection',
    'Calculated',
    'Under Review',
    'Approved',
    'Rejected',
    'Closed',
  ];
  protected readonly actionStatusOptions: MsaActionStatus[] = ['Open', 'In Progress', 'Closed'];

  protected readonly studies = computed(() => this.msaService.studies());
  protected readonly instruments = computed(() => this.instrumentService.instruments());

  protected readonly activeStudyType = signal<'All' | MsaStudyType>('All');
  protected readonly activeStatus = signal<'All' | MsaStudyStatus>('All');

  protected readonly filteredStudies = computed(() => {
    const studyType = this.activeStudyType();
    const status = this.activeStatus();
    return this.studies()
      .filter((item) => (studyType === 'All' ? true : item.studyType === studyType))
      .filter((item) => (status === 'All' ? true : item.status === status));
  });

  protected loading = false;
  protected error = '';

  protected createForm = {
    instrumentId: 0,
    studyType: 'GRR' as MsaStudyType,
    title: '',
    characteristic: '',
    method: '',
    toleranceMin: '',
    toleranceMax: '',
    resolution: '',
    referenceValue: '',
    ownerName: '',
    dueDate: '',
    operatorsCount: 3,
    partsCount: 10,
    trialsCount: 2,
    grrDesignType: 'Crossed' as 'Crossed' | 'Nested',
    randomized: true,
  };

  protected selectedStudy: MsaStudy | null = null;
  protected measurements: MsaMeasurement[] = [];
  protected results: MsaResult[] = [];
  protected actions: MsaAction[] = [];

  protected measurementForm = {
    operatorName: '',
    partName: '',
    trialNo: 1,
    measuredValue: '',
    referenceValue: '',
    measuredAt: '',
  };

  protected actionForm = {
    actionType: 'MSA Action',
    description: '',
    ownerName: '',
    targetDate: '',
    status: 'Open' as MsaActionStatus,
  };

  protected calculating = false;
  protected decisionNote = '';

  ngOnInit(): void {
    this.refresh();
  }

  protected refresh(): void {
    this.loading = true;
    this.error = '';
    forkJoin([this.msaService.listStudies(), this.instrumentService.listInstruments()]).subscribe({
      next: () => {
        this.loading = false;
      },
      error: () => {
        this.loading = false;
        this.error = 'Unable to load MSA workspace.';
      },
    });
  }

  protected setTypeFilter(value: 'All' | MsaStudyType): void {
    this.activeStudyType.set(value);
  }

  protected setStatusFilter(value: 'All' | MsaStudyStatus): void {
    this.activeStatus.set(value);
  }

  protected createStudy(): void {
    const title = this.createForm.title.trim();
    if (!title) {
      return;
    }

    const toNullableNumber = (value: string) => {
      if (!value.trim()) {
        return null;
      }
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    };

    const payload: any = {
      instrument_id: this.createForm.instrumentId || null,
      study_type: this.createForm.studyType,
      title,
      characteristic: this.createForm.characteristic.trim() || null,
      method: this.createForm.method.trim() || null,
      tolerance_min: toNullableNumber(this.createForm.toleranceMin),
      tolerance_max: toNullableNumber(this.createForm.toleranceMax),
      resolution: toNullableNumber(this.createForm.resolution),
      reference_value: toNullableNumber(this.createForm.referenceValue),
      owner_name: this.createForm.ownerName.trim() || null,
      due_date: this.createForm.dueDate || null,
    };

    if (this.createForm.studyType === 'GRR') {
      payload.grr_design = {
        operators_count: Math.max(1, Number(this.createForm.operatorsCount) || 3),
        parts_count: Math.max(1, Number(this.createForm.partsCount) || 10),
        trials_count: Math.max(1, Number(this.createForm.trialsCount) || 2),
        design_type: this.createForm.grrDesignType,
        randomized: this.createForm.randomized,
      };
    }

    this.msaService.createStudy(payload).subscribe({
      next: (study) => {
        this.createForm = {
          instrumentId: 0,
          studyType: 'GRR',
          title: '',
          characteristic: '',
          method: '',
          toleranceMin: '',
          toleranceMax: '',
          resolution: '',
          referenceValue: '',
          ownerName: '',
          dueDate: '',
          operatorsCount: 3,
          partsCount: 10,
          trialsCount: 2,
          grrDesignType: 'Crossed',
          randomized: true,
        };
        this.openStudy(study);
      },
      error: () => {
        this.error = 'Unable to create MSA study.';
      },
    });
  }

  protected openStudy(study: MsaStudy): void {
    this.selectedStudy = study;
    this.decisionNote = '';
    forkJoin([
      this.msaService.listMeasurements(study.id),
      this.msaService.listResults(study.id),
      this.msaService.listActions(study.id),
    ]).subscribe({
      next: ([measurements, results, actions]) => {
        this.measurements = measurements;
        this.results = results;
        this.actions = actions;
      },
      error: () => {
        this.error = 'Unable to load study details.';
      },
    });
  }

  protected addMeasurement(): void {
    if (!this.selectedStudy) {
      return;
    }
    const measuredValue = Number(this.measurementForm.measuredValue);
    if (!Number.isFinite(measuredValue)) {
      return;
    }
    const referenceValue = this.measurementForm.referenceValue.trim()
      ? Number(this.measurementForm.referenceValue)
      : null;

    this.msaService
      .addMeasurements(this.selectedStudy.id, [
        {
          operator_name: this.measurementForm.operatorName.trim() || null,
          part_name: this.measurementForm.partName.trim() || null,
          trial_no: Number(this.measurementForm.trialNo) || null,
          measured_value: measuredValue,
          reference_value: Number.isFinite(referenceValue ?? NaN) ? referenceValue : null,
          measured_at: this.measurementForm.measuredAt || null,
        },
      ])
      .subscribe({
        next: () => {
          this.measurementForm = {
            operatorName: '',
            partName: '',
            trialNo: 1,
            measuredValue: '',
            referenceValue: '',
            measuredAt: '',
          };
          if (this.selectedStudy) {
            this.msaService.listMeasurements(this.selectedStudy.id).subscribe((rows) => {
              this.measurements = rows;
              this.msaService.listStudies().subscribe((studies) => {
                const refreshed = studies.find((item) => item.id === this.selectedStudy?.id);
                if (refreshed) {
                  this.selectedStudy = refreshed;
                }
              });
            });
          }
        },
        error: () => {
          this.error = 'Unable to add measurement.';
        },
      });
  }

  protected calculateStudy(): void {
    if (!this.selectedStudy || this.calculating) {
      return;
    }
    this.calculating = true;
    this.error = '';
    this.msaService.calculateStudy(this.selectedStudy.id).subscribe({
      next: (payload) => {
        this.calculating = false;
        this.decisionNote = payload.autoActionId ? `Auto action #${payload.autoActionId} created for failed result.` : '';
        if (this.selectedStudy) {
          this.openStudy(this.selectedStudy);
          this.msaService.listStudies().subscribe((studies) => {
            const refreshed = studies.find((item) => item.id === this.selectedStudy?.id);
            if (refreshed) {
              this.selectedStudy = refreshed;
            }
          });
        }
      },
      error: (error) => {
        this.calculating = false;
        this.error = String(error?.error?.detail ?? 'Unable to calculate study.');
      },
    });
  }

  protected approveStudy(): void {
    if (!this.selectedStudy) {
      return;
    }
    this.msaService.approveStudy(this.selectedStudy.id).subscribe({
      next: ({ study }) => {
        this.selectedStudy = study;
        this.decisionNote = 'Study approved.';
      },
      error: (error) => {
        this.error = String(error?.error?.detail ?? 'Unable to approve study.');
      },
    });
  }

  protected rejectStudy(): void {
    if (!this.selectedStudy) {
      return;
    }
    const reason = prompt('Enter rejection reason') || '';
    this.msaService.rejectStudy(this.selectedStudy.id, reason).subscribe({
      next: ({ study }) => {
        this.selectedStudy = study;
        this.decisionNote = 'Study rejected.';
      },
      error: (error) => {
        this.error = String(error?.error?.detail ?? 'Unable to reject study.');
      },
    });
  }

  protected createAction(): void {
    if (!this.selectedStudy || !this.actionForm.description.trim()) {
      return;
    }
    this.msaService
      .createAction(this.selectedStudy.id, {
        action_type: this.actionForm.actionType.trim() || 'MSA Action',
        description: this.actionForm.description.trim(),
        owner_name: this.actionForm.ownerName.trim() || null,
        target_date: this.actionForm.targetDate || null,
        status: this.actionForm.status,
      })
      .subscribe({
        next: (action) => {
          this.actions = [action, ...this.actions];
          this.actionForm = {
            actionType: 'MSA Action',
            description: '',
            ownerName: '',
            targetDate: '',
            status: 'Open',
          };
        },
      });
  }

  protected latestResult(): MsaResult | null {
    return this.results.length ? this.results[0] : null;
  }

  protected metricRows(): Array<{ key: string; value: string }> {
    const result = this.latestResult();
    if (!result) {
      return [];
    }
    return Object.entries(result.metrics).map(([key, value]) => {
      const displayValue = typeof value === 'number' ? value.toFixed(4) : JSON.stringify(value);
      return { key, value: displayValue };
    });
  }
}
