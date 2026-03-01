import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Observable, map, tap } from 'rxjs';

export type MsaStudyType = 'GRR' | 'Bias' | 'Linearity' | 'Stability';
export type MsaStudyStatus =
  | 'Draft'
  | 'Data Collection'
  | 'Calculated'
  | 'Under Review'
  | 'Approved'
  | 'Rejected'
  | 'Closed';
export type MsaPassFail = 'Pass' | 'Conditional' | 'Fail';
export type MsaActionStatus = 'Open' | 'In Progress' | 'Closed';

export type MsaStudy = {
  id: number;
  code: string;
  studyType: MsaStudyType;
  title: string;
  characteristic: string;
  method: string;
  designType: string;
  toleranceMin: number | null;
  toleranceMax: number | null;
  resolution: number | null;
  referenceValue: number | null;
  ownerName: string;
  dueDate: string;
  status: MsaStudyStatus;
  reviewNotes: string;
  instrumentId: number | null;
  instrumentCode: string;
  instrumentName: string;
  latestResult: MsaPassFail | '';
  latestResultAt: string;
  createdAt: string;
  updatedAt: string;
};

export type MsaMeasurement = {
  id: number;
  studyId: number;
  operatorName: string;
  partName: string;
  trialNo: number | null;
  measuredValue: number;
  referenceValue: number | null;
  measuredAt: string;
  createdAt: string;
};

export type MsaResult = {
  id: number;
  studyId: number;
  resultType: MsaStudyType;
  metrics: Record<string, unknown>;
  passFail: MsaPassFail;
  recommendation: string;
  calculatedBy: number | null;
  calculatedAt: string;
  approvedBy: number | null;
  approvedAt: string;
  createdAt: string;
};

export type MsaAction = {
  id: number;
  studyId: number;
  actionType: string;
  description: string;
  ownerName: string;
  targetDate: string;
  status: MsaActionStatus;
  linkedNcId: number | null;
  createdAt: string;
  updatedAt: string;
};

@Injectable({ providedIn: 'root' })
export class MsaService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = '/api';

  private readonly studiesSignal = signal<MsaStudy[]>([]);

  readonly studies = this.studiesSignal.asReadonly();

  listStudies(): Observable<MsaStudy[]> {
    return this.http.get<unknown[]>(`${this.baseUrl}/msa/studies`).pipe(
      map((rows) => (Array.isArray(rows) ? rows.map((row) => this.mapStudy(row)) : [])),
      tap((rows) => this.studiesSignal.set(rows))
    );
  }

  createStudy(payload: {
    instrument_id?: number | null;
    study_type: MsaStudyType;
    title: string;
    characteristic?: string | null;
    method?: string | null;
    design_type?: string | null;
    tolerance_min?: number | null;
    tolerance_max?: number | null;
    resolution?: number | null;
    reference_value?: number | null;
    owner_name?: string | null;
    due_date?: string | null;
    status?: MsaStudyStatus;
    review_notes?: string | null;
    grr_design?: {
      operators_count?: number;
      parts_count?: number;
      trials_count?: number;
      design_type?: 'Crossed' | 'Nested';
      randomized?: boolean;
    };
  }): Observable<MsaStudy> {
    return this.http.post<unknown>(`${this.baseUrl}/msa/studies`, payload).pipe(
      map((row) => this.mapStudy(row)),
      tap((study) => this.studiesSignal.set([study, ...this.studiesSignal()]))
    );
  }

  updateStudy(studyId: number, payload: Record<string, unknown>): Observable<MsaStudy> {
    return this.http.put<unknown>(`${this.baseUrl}/msa/studies/${studyId}`, payload).pipe(
      map((row) => this.mapStudy(row)),
      tap((study) => {
        this.studiesSignal.set(this.studiesSignal().map((row) => (row.id === study.id ? study : row)));
      })
    );
  }

  listMeasurements(studyId: number): Observable<MsaMeasurement[]> {
    return this.http.get<unknown[]>(`${this.baseUrl}/msa/studies/${studyId}/measurements`).pipe(
      map((rows) => (Array.isArray(rows) ? rows.map((row) => this.mapMeasurement(row)) : []))
    );
  }

  addMeasurements(
    studyId: number,
    rows: Array<{
      operator_name?: string | null;
      part_name?: string | null;
      trial_no?: number | null;
      measured_value: number;
      reference_value?: number | null;
      measured_at?: string | null;
    }>
  ): Observable<{ insertedCount: number; rows: MsaMeasurement[] }> {
    return this.http
      .post<any>(`${this.baseUrl}/msa/studies/${studyId}/measurements`, { rows })
      .pipe(
        map((payload) => ({
          insertedCount: Number(payload?.inserted_count ?? 0),
          rows: Array.isArray(payload?.rows) ? payload.rows.map((row: unknown) => this.mapMeasurement(row)) : [],
        }))
      );
  }

  listResults(studyId: number): Observable<MsaResult[]> {
    return this.http.get<unknown[]>(`${this.baseUrl}/msa/studies/${studyId}/results`).pipe(
      map((rows) => (Array.isArray(rows) ? rows.map((row) => this.mapResult(row)) : []))
    );
  }

  calculateStudy(studyId: number): Observable<{ result: MsaResult; status: string; autoActionId: number | null }> {
    return this.http.post<any>(`${this.baseUrl}/msa/studies/${studyId}/calculate`, {}).pipe(
      map((payload) => ({
        result: this.mapResult(payload?.result),
        status: String(payload?.status ?? ''),
        autoActionId: payload?.auto_action_id === null || payload?.auto_action_id === undefined
          ? null
          : Number(payload.auto_action_id),
      }))
    );
  }

  approveStudy(studyId: number): Observable<{ detail: string; study: MsaStudy }> {
    return this.http.post<any>(`${this.baseUrl}/msa/studies/${studyId}/approve`, {}).pipe(
      map((payload) => ({
        detail: String(payload?.detail ?? ''),
        study: this.mapStudy(payload?.study),
      })),
      tap((payload) => {
        this.studiesSignal.set(this.studiesSignal().map((row) => (row.id === payload.study.id ? payload.study : row)));
      })
    );
  }

  rejectStudy(studyId: number, reason: string): Observable<{ detail: string; study: MsaStudy }> {
    return this.http.post<any>(`${this.baseUrl}/msa/studies/${studyId}/reject`, { reason }).pipe(
      map((payload) => ({
        detail: String(payload?.detail ?? ''),
        study: this.mapStudy(payload?.study),
      })),
      tap((payload) => {
        this.studiesSignal.set(this.studiesSignal().map((row) => (row.id === payload.study.id ? payload.study : row)));
      })
    );
  }

  listActions(studyId: number): Observable<MsaAction[]> {
    return this.http.get<unknown[]>(`${this.baseUrl}/msa/studies/${studyId}/actions`).pipe(
      map((rows) => (Array.isArray(rows) ? rows.map((row) => this.mapAction(row)) : []))
    );
  }

  createAction(
    studyId: number,
    payload: {
      action_type?: string;
      description: string;
      owner_name?: string | null;
      target_date?: string | null;
      status?: MsaActionStatus;
      linked_nc_id?: number | null;
    }
  ): Observable<MsaAction> {
    return this.http.post<unknown>(`${this.baseUrl}/msa/studies/${studyId}/actions`, payload).pipe(
      map((row) => this.mapAction(row))
    );
  }

  private mapStudy(payload: any): MsaStudy {
    return {
      id: Number(payload?.id ?? 0),
      code: String(payload?.code ?? ''),
      studyType: String(payload?.study_type ?? 'GRR') as MsaStudyType,
      title: String(payload?.title ?? ''),
      characteristic: String(payload?.characteristic ?? ''),
      method: String(payload?.method ?? ''),
      designType: String(payload?.design_type ?? ''),
      toleranceMin: payload?.tolerance_min === null || payload?.tolerance_min === undefined ? null : Number(payload.tolerance_min),
      toleranceMax: payload?.tolerance_max === null || payload?.tolerance_max === undefined ? null : Number(payload.tolerance_max),
      resolution: payload?.resolution === null || payload?.resolution === undefined ? null : Number(payload.resolution),
      referenceValue: payload?.reference_value === null || payload?.reference_value === undefined ? null : Number(payload.reference_value),
      ownerName: String(payload?.owner_name ?? ''),
      dueDate: String(payload?.due_date ?? ''),
      status: String(payload?.status ?? 'Draft') as MsaStudyStatus,
      reviewNotes: String(payload?.review_notes ?? ''),
      instrumentId: payload?.instrument_id === null || payload?.instrument_id === undefined ? null : Number(payload.instrument_id),
      instrumentCode: String(payload?.instrument_code ?? ''),
      instrumentName: String(payload?.instrument_name ?? ''),
      latestResult: String(payload?.latest_result ?? '') as MsaPassFail | '',
      latestResultAt: String(payload?.latest_result_at ?? ''),
      createdAt: String(payload?.created_at ?? ''),
      updatedAt: String(payload?.updated_at ?? ''),
    };
  }

  private mapMeasurement(payload: any): MsaMeasurement {
    return {
      id: Number(payload?.id ?? 0),
      studyId: Number(payload?.study_id ?? 0),
      operatorName: String(payload?.operator_name ?? ''),
      partName: String(payload?.part_name ?? ''),
      trialNo: payload?.trial_no === null || payload?.trial_no === undefined ? null : Number(payload.trial_no),
      measuredValue: Number(payload?.measured_value ?? 0),
      referenceValue: payload?.reference_value === null || payload?.reference_value === undefined ? null : Number(payload.reference_value),
      measuredAt: String(payload?.measured_at ?? ''),
      createdAt: String(payload?.created_at ?? ''),
    };
  }

  private mapResult(payload: any): MsaResult {
    return {
      id: Number(payload?.id ?? 0),
      studyId: Number(payload?.study_id ?? 0),
      resultType: String(payload?.result_type ?? 'GRR') as MsaStudyType,
      metrics: payload?.metrics_json && typeof payload.metrics_json === 'object' ? payload.metrics_json : {},
      passFail: String(payload?.pass_fail ?? 'Conditional') as MsaPassFail,
      recommendation: String(payload?.recommendation ?? ''),
      calculatedBy: payload?.calculated_by === null || payload?.calculated_by === undefined ? null : Number(payload.calculated_by),
      calculatedAt: String(payload?.calculated_at ?? ''),
      approvedBy: payload?.approved_by === null || payload?.approved_by === undefined ? null : Number(payload.approved_by),
      approvedAt: String(payload?.approved_at ?? ''),
      createdAt: String(payload?.created_at ?? ''),
    };
  }

  private mapAction(payload: any): MsaAction {
    return {
      id: Number(payload?.id ?? 0),
      studyId: Number(payload?.study_id ?? 0),
      actionType: String(payload?.action_type ?? ''),
      description: String(payload?.description ?? ''),
      ownerName: String(payload?.owner_name ?? ''),
      targetDate: String(payload?.target_date ?? ''),
      status: String(payload?.status ?? 'Open') as MsaActionStatus,
      linkedNcId: payload?.linked_nc_id === null || payload?.linked_nc_id === undefined ? null : Number(payload.linked_nc_id),
      createdAt: String(payload?.created_at ?? ''),
      updatedAt: String(payload?.updated_at ?? ''),
    };
  }
}
