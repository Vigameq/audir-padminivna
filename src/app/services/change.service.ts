import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Observable, map, tap } from 'rxjs';

export type ChangeRequestType = 'ECR' | 'ECN';
export type FourMCategory = 'Man' | 'Machine' | 'Method' | 'Material';
export type ChangeRiskLevel = 'Low' | 'Medium' | 'High' | 'Critical';
export type ChangeStatus =
  | 'Draft'
  | 'Open'
  | 'In Review'
  | 'Approved'
  | 'Implemented'
  | 'Rejected'
  | 'Closed';

export type ChangeRecord = {
  id: number;
  code: string;
  requestType: ChangeRequestType;
  title: string;
  description: string;
  fourMCategory: FourMCategory;
  changeReason: string;
  impactAssessment: string;
  riskLevel: ChangeRiskLevel;
  status: ChangeStatus;
  requestedBy: string;
  requestedDate: string;
  targetDate: string;
  approvedBy: string;
  approvedAt: string;
  implementedAt: string;
  createdAt: string;
  updatedAt: string;
};

@Injectable({ providedIn: 'root' })
export class ChangeService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = '/api';
  private readonly changesSignal = signal<ChangeRecord[]>([]);

  readonly changes = this.changesSignal.asReadonly();

  listChanges(): Observable<ChangeRecord[]> {
    return this.http.get<unknown[]>(`${this.baseUrl}/changes`).pipe(
      map((rows) => (Array.isArray(rows) ? rows.map((row) => this.mapFromApi(row)) : [])),
      tap((rows) => this.changesSignal.set(rows))
    );
  }

  createChange(payload: {
    request_type: ChangeRequestType;
    title: string;
    description?: string | null;
    four_m_category: FourMCategory;
    change_reason?: string | null;
    impact_assessment?: string | null;
    risk_level: ChangeRiskLevel;
    status?: ChangeStatus;
    requested_by?: string | null;
    requested_date?: string | null;
    target_date?: string | null;
    approved_by?: string | null;
  }): Observable<ChangeRecord> {
    return this.http.post<unknown>(`${this.baseUrl}/changes`, payload).pipe(
      map((row) => this.mapFromApi(row)),
      tap((created) => this.changesSignal.set([created, ...this.changesSignal()]))
    );
  }

  updateChange(
    id: number,
    payload: {
      request_type?: ChangeRequestType;
      title?: string;
      description?: string | null;
      four_m_category?: FourMCategory;
      change_reason?: string | null;
      impact_assessment?: string | null;
      risk_level?: ChangeRiskLevel;
      status?: ChangeStatus;
      requested_by?: string | null;
      requested_date?: string | null;
      target_date?: string | null;
      approved_by?: string | null;
    }
  ): Observable<ChangeRecord> {
    return this.http.put<unknown>(`${this.baseUrl}/changes/${id}`, payload).pipe(
      map((row) => this.mapFromApi(row)),
      tap((updated) => {
        this.changesSignal.set(this.changesSignal().map((item) => (item.id === updated.id ? updated : item)));
      })
    );
  }

  private mapFromApi(payload: any): ChangeRecord {
    return {
      id: Number(payload?.id ?? 0),
      code: String(payload?.code ?? ''),
      requestType: String(payload?.request_type ?? 'ECR') as ChangeRequestType,
      title: String(payload?.title ?? ''),
      description: String(payload?.description ?? ''),
      fourMCategory: String(payload?.four_m_category ?? 'Method') as FourMCategory,
      changeReason: String(payload?.change_reason ?? ''),
      impactAssessment: String(payload?.impact_assessment ?? ''),
      riskLevel: String(payload?.risk_level ?? 'Medium') as ChangeRiskLevel,
      status: String(payload?.status ?? 'Open') as ChangeStatus,
      requestedBy: String(payload?.requested_by ?? ''),
      requestedDate: String(payload?.requested_date ?? ''),
      targetDate: String(payload?.target_date ?? ''),
      approvedBy: String(payload?.approved_by ?? ''),
      approvedAt: String(payload?.approved_at ?? ''),
      implementedAt: String(payload?.implemented_at ?? ''),
      createdAt: String(payload?.created_at ?? ''),
      updatedAt: String(payload?.updated_at ?? ''),
    };
  }
}
