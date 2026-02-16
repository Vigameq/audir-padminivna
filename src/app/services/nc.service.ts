import { HttpClient } from '@angular/common/http';
import { Injectable, signal } from '@angular/core';
import { Observable, map, tap } from 'rxjs';

export type NcRecord = {
  answerId: string;
  auditCode: string;
  auditType: string;
  auditSubtype: string;
  startDate: string;
  endDate: string;
  auditorName: string;
  assetNumber?: number;
  question: string;
  response: string;
  assignedNc: string;
  note: string;
  submittedAt: string;
  assignedUserId?: number;
  assignedUserName?: string;
  assignedUserEmail?: string;
  rootCause?: string;
  containmentAction?: string;
  correctiveAction?: string;
  preventiveAction?: string;
  evidenceName?: string;
  status?: string;
};

@Injectable({ providedIn: 'root' })
export class NcService {
  private readonly recordsSignal = signal<NcRecord[]>([]);
  private readonly baseUrl = '/api';

  readonly records = this.recordsSignal.asReadonly();

  constructor(private readonly http: HttpClient) {}

  listRecords(): Observable<NcRecord[]> {
    return this.http.get<unknown[]>(`${this.baseUrl}/nc-records`).pipe(
      map((rows) => (Array.isArray(rows) ? rows.map((row) => this.mapFromApi(row)) : [])),
      tap((records) => this.recordsSignal.set(records))
    );
  }

  upsertAction(payload: {
    answer_id: string;
    root_cause?: string | null;
    containment_action?: string | null;
    corrective_action?: string | null;
    preventive_action?: string | null;
    evidence_name?: string | null;
    assigned_user_id?: number | null;
    status?: string;
  }): Observable<unknown> {
    return this.http.post(`${this.baseUrl}/nc-actions`, payload);
  }

  assignUser(answerId: string, userId: number, status: string): Observable<unknown> {
    return this.http.post(`${this.baseUrl}/nc-actions`, {
      answer_id: answerId,
      assigned_user_id: userId,
      status,
    });
  }

  updateAssignedNc(answerId: string, assignedNc: string): Observable<unknown> {
    return this.http.put(`${this.baseUrl}/audit-answers/${answerId}/assigned-nc`, {
      assigned_nc: assignedNc,
    });
  }

  private mapFromApi(payload: any): NcRecord {
    const firstName = String(payload?.assigned_user_first_name ?? '').trim();
    const lastName = String(payload?.assigned_user_last_name ?? '').trim();
    const name = [firstName, lastName].filter(Boolean).join(' ').trim();
    return {
      answerId: String(payload?.answer_id ?? ''),
      auditCode: String(payload?.audit_code ?? ''),
      auditType: String(payload?.audit_type ?? ''),
      auditSubtype: String(payload?.audit_subtype ?? ''),
      startDate: String(payload?.start_date ?? ''),
      endDate: String(payload?.end_date ?? ''),
      auditorName: String(payload?.auditor_name ?? ''),
      assetNumber:
        payload?.asset_number !== undefined && payload?.asset_number !== null
          ? Number(payload.asset_number)
          : undefined,
      question: String(payload?.question_text ?? ''),
      response: String(payload?.response ?? ''),
      assignedNc: String(payload?.assigned_nc ?? ''),
      note: String(payload?.note ?? ''),
      submittedAt: String(payload?.submitted_at ?? ''),
      assignedUserId:
        payload?.assigned_user_id !== undefined && payload?.assigned_user_id !== null
          ? Number(payload.assigned_user_id)
          : undefined,
      assignedUserName: name || undefined,
      assignedUserEmail: payload?.assigned_user_email
        ? String(payload.assigned_user_email)
        : undefined,
      rootCause: String(payload?.root_cause ?? ''),
      containmentAction: String(payload?.containment_action ?? ''),
      correctiveAction: String(payload?.corrective_action ?? ''),
      preventiveAction: String(payload?.preventive_action ?? ''),
      evidenceName: String(payload?.evidence_name ?? ''),
      status: String(payload?.nc_status ?? ''),
    };
  }
}
