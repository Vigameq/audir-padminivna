import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable, map } from 'rxjs';

export type AuditAnswerRecord = {
  id: string;
  auditPlanId: string;
  assetNumber: number | null;
  questionIndex: number;
  questionText: string;
  response: string;
  responseIsNegative: boolean;
  assignedNc: string;
  note: string;
  evidenceName: string;
  evidenceDataUrl: string;
  evidenceUrls: string[];
  status: string;
  createdAt: string;
  updatedAt: string;
};

@Injectable({ providedIn: 'root' })
export class AuditAnswerService {
  private readonly baseUrl = '/api';

  constructor(private readonly http: HttpClient) {}

  listByAuditCode(code: string): Observable<AuditAnswerRecord[]> {
    return this.http
      .get<unknown[]>(`${this.baseUrl}/audit-answers?audit_code=${encodeURIComponent(code)}`)
      .pipe(map((rows) => (Array.isArray(rows) ? rows.map((row) => this.mapFromApi(row)) : [])));
  }

  upsertAnswer(payload: {
    audit_code: string;
    asset_number?: number | null;
    question_index: number;
    question_text: string;
    response?: string | null;
    response_is_negative?: boolean;
    assigned_nc?: string | null;
    note?: string | null;
    evidence_name?: string | null;
    evidence_data_url?: string | null;
    evidence_urls?: string[] | null;
    status?: string;
  }): Observable<AuditAnswerRecord> {
    return this.http.post<AuditAnswerRecord>(`${this.baseUrl}/audit-answers`, payload);
  }

  getEvidenceUploadUrls(payload: {
    audit_code: string;
    asset_number: number;
    question_index: number;
    files: { name: string; type: string }[];
  }): Observable<{
    folderUrl: string;
    uploads: { name: string; key: string; uploadUrl: string; publicUrl: string }[];
  }> {
    return this.http.post<{
      folderUrl: string;
      uploads: { name: string; key: string; uploadUrl: string; publicUrl: string }[];
    }>(`${this.baseUrl}/evidence/presign`, payload);
  }

  getEvidenceViewUrls(payload: { keys: string[]; audit_code: string }): Observable<{ urls: string[] }> {
    return this.http.post<{ urls: string[] }>(`${this.baseUrl}/evidence/sign`, payload);
  }

  private mapFromApi(payload: any): AuditAnswerRecord {
    return {
      id: String(payload?.id ?? ''),
      auditPlanId: String(payload?.audit_plan_id ?? ''),
      assetNumber:
        payload?.asset_number !== undefined && payload?.asset_number !== null
          ? Number(payload.asset_number)
          : null,
      questionIndex: Number(payload?.question_index ?? 0),
      questionText: String(payload?.question_text ?? ''),
      response: String(payload?.response ?? ''),
      responseIsNegative: Boolean(payload?.response_is_negative ?? false),
      assignedNc: String(payload?.assigned_nc ?? ''),
      note: String(payload?.note ?? ''),
      evidenceName: String(payload?.evidence_name ?? ''),
      evidenceDataUrl: String(payload?.evidence_data_url ?? ''),
      evidenceUrls: Array.isArray(payload?.evidence_urls)
        ? payload.evidence_urls.map((url: any) => String(url)).filter(Boolean)
        : [],
      status: String(payload?.status ?? ''),
      createdAt: String(payload?.created_at ?? ''),
      updatedAt: String(payload?.updated_at ?? ''),
    };
  }
}
