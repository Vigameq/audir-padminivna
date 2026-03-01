import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Observable, map, tap } from 'rxjs';

export type ComplaintType = 'Customer' | 'Internal';
export type ComplaintCategory = 'Inprocess' | 'Supplier';
export type ComplaintStatus = 'Open' | 'In Progress' | 'Closed';
export type ComplaintEscalationStatus = 'None' | 'Escalated' | 'Final' | 'Closed';

export type ComplaintRecord = {
  id: number;
  code: string;
  complaintType: ComplaintType;
  category: ComplaintCategory;
  title: string;
  description: string;
  sourceName: string;
  reportedBy: string;
  complaintDate: string;
  status: ComplaintStatus;
  assignedTo: string;
  resolution: string;
  targetCloseAt: string;
  escalationLevel: number;
  escalationStatus: ComplaintEscalationStatus;
  lastEscalatedAt: string;
  escalationOwner: string;
  closedAt: string;
  createdAt: string;
  updatedAt: string;
};

export type ComplaintEscalationRule = {
  id: number;
  complaintType: ComplaintType;
  category: ComplaintCategory;
  level: number;
  thresholdHours: number;
  notifyRole: 'Super Admin' | 'Admin' | 'Manager' | 'Auditor';
  createdAt: string;
  updatedAt: string;
};

@Injectable({ providedIn: 'root' })
export class ComplaintService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = '/api';
  private readonly complaintsSignal = signal<ComplaintRecord[]>([]);

  readonly complaints = this.complaintsSignal.asReadonly();

  listComplaints(): Observable<ComplaintRecord[]> {
    return this.http.get<unknown[]>(`${this.baseUrl}/complaints`).pipe(
      map((rows) => (Array.isArray(rows) ? rows.map((row) => this.mapFromApi(row)) : [])),
      tap((rows) => this.complaintsSignal.set(rows))
    );
  }

  createComplaint(payload: {
    complaint_type: ComplaintType;
    category: ComplaintCategory;
    title: string;
    description?: string | null;
    source_name?: string | null;
    reported_by?: string | null;
    complaint_date?: string | null;
    assigned_to?: string | null;
  }): Observable<ComplaintRecord> {
    return this.http.post<unknown>(`${this.baseUrl}/complaints`, payload).pipe(
      map((row) => this.mapFromApi(row)),
      tap((created) => this.complaintsSignal.set([created, ...this.complaintsSignal()]))
    );
  }

  updateComplaint(
    id: number,
    payload: {
      complaint_type?: ComplaintType;
      category?: ComplaintCategory;
      title?: string;
      description?: string | null;
      source_name?: string | null;
      reported_by?: string | null;
      complaint_date?: string | null;
      status?: ComplaintStatus;
      assigned_to?: string | null;
      resolution?: string | null;
    }
  ): Observable<ComplaintRecord> {
    return this.http.put<unknown>(`${this.baseUrl}/complaints/${id}`, payload).pipe(
      map((row) => this.mapFromApi(row)),
      tap((updated) => {
        this.complaintsSignal.set(
          this.complaintsSignal().map((item) => (item.id === updated.id ? updated : item))
        );
      })
    );
  }

  runEscalation(): Observable<{ detail: string; scanned: number; escalated: number }> {
    return this.http.post<{ detail: string; scanned: number; escalated: number }>(
      `${this.baseUrl}/complaints/escalations/run`,
      {}
    );
  }

  listEscalationRules(): Observable<ComplaintEscalationRule[]> {
    return this.http.get<unknown[]>(`${this.baseUrl}/complaints/escalation-rules`).pipe(
      map((rows) => (Array.isArray(rows) ? rows.map((row) => this.mapRuleFromApi(row)) : []))
    );
  }

  updateEscalationRule(
    id: number,
    payload: { threshold_hours: number; notify_role: 'Super Admin' | 'Admin' | 'Manager' | 'Auditor' }
  ): Observable<ComplaintEscalationRule> {
    return this.http
      .put<unknown>(`${this.baseUrl}/complaints/escalation-rules/${id}`, payload)
      .pipe(map((row) => this.mapRuleFromApi(row)));
  }

  private mapFromApi(payload: any): ComplaintRecord {
    return {
      id: Number(payload?.id ?? 0),
      code: String(payload?.code ?? ''),
      complaintType: (String(payload?.complaint_type ?? 'Internal') as ComplaintType),
      category: (String(payload?.category ?? 'Inprocess') as ComplaintCategory),
      title: String(payload?.title ?? ''),
      description: String(payload?.description ?? ''),
      sourceName: String(payload?.source_name ?? ''),
      reportedBy: String(payload?.reported_by ?? ''),
      complaintDate: String(payload?.complaint_date ?? ''),
      status: (String(payload?.status ?? 'Open') as ComplaintStatus),
      assignedTo: String(payload?.assigned_to ?? ''),
      resolution: String(payload?.resolution ?? ''),
      targetCloseAt: String(payload?.target_close_at ?? ''),
      escalationLevel: Number(payload?.escalation_level ?? 0),
      escalationStatus: (String(payload?.escalation_status ?? 'None') as ComplaintEscalationStatus),
      lastEscalatedAt: String(payload?.last_escalated_at ?? ''),
      escalationOwner: String(payload?.escalation_owner ?? ''),
      closedAt: String(payload?.closed_at ?? ''),
      createdAt: String(payload?.created_at ?? ''),
      updatedAt: String(payload?.updated_at ?? ''),
    };
  }

  private mapRuleFromApi(payload: any): ComplaintEscalationRule {
    return {
      id: Number(payload?.id ?? 0),
      complaintType: (String(payload?.complaint_type ?? 'Internal') as ComplaintType),
      category: (String(payload?.category ?? 'Inprocess') as ComplaintCategory),
      level: Number(payload?.level ?? 0),
      thresholdHours: Number(payload?.threshold_hours ?? 0),
      notifyRole: String(payload?.notify_role ?? 'Manager') as ComplaintEscalationRule['notifyRole'],
      createdAt: String(payload?.created_at ?? ''),
      updatedAt: String(payload?.updated_at ?? ''),
    };
  }
}
