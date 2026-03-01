import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Observable, map, tap } from 'rxjs';

export type LessonSourceType = 'Audit' | 'NC' | 'Complaint' | 'Change' | 'Manual';
export type LessonRiskLevel = 'Low' | 'Medium' | 'High' | 'Critical';
export type LessonApplicability = 'Plant' | 'Line' | 'Product' | 'Global';
export type LessonStatus = 'Draft' | 'Published' | 'Archived';

export type LessonRecord = {
  id: number;
  code: string;
  title: string;
  summary: string;
  problemStatement: string;
  rootCause: string;
  whatWorked: string;
  whatFailed: string;
  preventiveRecommendation: string;
  standardizationAction: string;
  sourceType: LessonSourceType;
  sourceRef: string;
  category: string;
  department: string;
  tags: string[];
  riskLevel: LessonRiskLevel;
  applicability: LessonApplicability;
  status: LessonStatus;
  ownerId?: number;
  approvedBy?: number;
  approvedAt: string;
  effectiveFrom: string;
  reviewDueAt: string;
  createdAt: string;
  updatedAt: string;
};

export type LessonKpis = {
  draftCount: number;
  publishedCount: number;
  archivedCount: number;
  publishedThisMonth: number;
  lessonsWithAck: number;
  totalAckRows: number;
};

@Injectable({ providedIn: 'root' })
export class LessonService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = '/api';
  private readonly lessonsSignal = signal<LessonRecord[]>([]);

  readonly lessons = this.lessonsSignal.asReadonly();

  listLessons(filters?: {
    status?: LessonStatus | 'All';
    sourceType?: LessonSourceType | 'All';
    q?: string;
    tag?: string;
  }): Observable<LessonRecord[]> {
    let params = new HttpParams();
    if (filters?.status && filters.status !== 'All') {
      params = params.set('status', filters.status);
    }
    if (filters?.sourceType && filters.sourceType !== 'All') {
      params = params.set('source_type', filters.sourceType);
    }
    if (filters?.q?.trim()) {
      params = params.set('q', filters.q.trim());
    }
    if (filters?.tag?.trim()) {
      params = params.set('tag', filters.tag.trim());
    }
    return this.http.get<unknown[]>(`${this.baseUrl}/lessons`, { params }).pipe(
      map((rows) => (Array.isArray(rows) ? rows.map((row) => this.mapFromApi(row)) : [])),
      tap((rows) => this.lessonsSignal.set(rows))
    );
  }

  createLesson(payload: {
    title: string;
    summary?: string | null;
    problem_statement?: string | null;
    root_cause?: string | null;
    what_worked?: string | null;
    what_failed?: string | null;
    preventive_recommendation?: string | null;
    standardization_action?: string | null;
    source_type: LessonSourceType;
    source_ref?: string | null;
    category?: string | null;
    department?: string | null;
    tags?: string[];
    risk_level: LessonRiskLevel;
    applicability: LessonApplicability;
    status?: LessonStatus;
    owner_id?: number | null;
    effective_from?: string | null;
    review_due_at?: string | null;
  }): Observable<LessonRecord> {
    return this.http.post<unknown>(`${this.baseUrl}/lessons`, payload).pipe(
      map((row) => this.mapFromApi(row)),
      tap((created) => this.lessonsSignal.set([created, ...this.lessonsSignal()]))
    );
  }

  updateLesson(
    id: number,
    payload: {
      title?: string;
      summary?: string | null;
      problem_statement?: string | null;
      root_cause?: string | null;
      what_worked?: string | null;
      what_failed?: string | null;
      preventive_recommendation?: string | null;
      standardization_action?: string | null;
      source_type?: LessonSourceType;
      source_ref?: string | null;
      category?: string | null;
      department?: string | null;
      tags?: string[];
      risk_level?: LessonRiskLevel;
      applicability?: LessonApplicability;
      status?: LessonStatus;
      owner_id?: number | null;
      effective_from?: string | null;
      review_due_at?: string | null;
    }
  ): Observable<LessonRecord> {
    return this.http.put<unknown>(`${this.baseUrl}/lessons/${id}`, payload).pipe(
      map((row) => this.mapFromApi(row)),
      tap((updated) => {
        this.lessonsSignal.set(this.lessonsSignal().map((item) => (item.id === updated.id ? updated : item)));
      })
    );
  }

  publishLesson(id: number): Observable<unknown> {
    return this.http.post(`${this.baseUrl}/lessons/${id}/publish`, {});
  }

  archiveLesson(id: number): Observable<unknown> {
    return this.http.post(`${this.baseUrl}/lessons/${id}/archive`, {});
  }

  acknowledgeLesson(id: number): Observable<unknown> {
    return this.http.post(`${this.baseUrl}/lessons/${id}/acknowledge`, {});
  }

  getAcknowledgementStatus(
    id: number
  ): Observable<{ totalUsers: number; acknowledgedCount: number; acknowledgements: { user_id: number; acknowledged_at: string }[] }> {
    return this.http.get<any>(`${this.baseUrl}/lessons/${id}/ack-status`).pipe(
      map((payload) => ({
        totalUsers: Number(payload?.total_users ?? 0),
        acknowledgedCount: Number(payload?.acknowledged_count ?? 0),
        acknowledgements: Array.isArray(payload?.acknowledgements) ? payload.acknowledgements : [],
      }))
    );
  }

  getKpis(): Observable<LessonKpis> {
    return this.http.get<any>(`${this.baseUrl}/lessons/kpis`).pipe(
      map((payload) => ({
        draftCount: Number(payload?.draft_count ?? 0),
        publishedCount: Number(payload?.published_count ?? 0),
        archivedCount: Number(payload?.archived_count ?? 0),
        publishedThisMonth: Number(payload?.published_this_month ?? 0),
        lessonsWithAck: Number(payload?.lessons_with_ack ?? 0),
        totalAckRows: Number(payload?.total_ack_rows ?? 0),
      }))
    );
  }

  private mapFromApi(payload: any): LessonRecord {
    return {
      id: Number(payload?.id ?? 0),
      code: String(payload?.code ?? ''),
      title: String(payload?.title ?? ''),
      summary: String(payload?.summary ?? ''),
      problemStatement: String(payload?.problem_statement ?? ''),
      rootCause: String(payload?.root_cause ?? ''),
      whatWorked: String(payload?.what_worked ?? ''),
      whatFailed: String(payload?.what_failed ?? ''),
      preventiveRecommendation: String(payload?.preventive_recommendation ?? ''),
      standardizationAction: String(payload?.standardization_action ?? ''),
      sourceType: String(payload?.source_type ?? 'Manual') as LessonSourceType,
      sourceRef: String(payload?.source_ref ?? ''),
      category: String(payload?.category ?? ''),
      department: String(payload?.department ?? ''),
      tags: Array.isArray(payload?.tags) ? payload.tags.map((tag: unknown) => String(tag)) : [],
      riskLevel: String(payload?.risk_level ?? 'Medium') as LessonRiskLevel,
      applicability: String(payload?.applicability ?? 'Plant') as LessonApplicability,
      status: String(payload?.status ?? 'Draft') as LessonStatus,
      ownerId:
        payload?.owner_id !== undefined && payload?.owner_id !== null
          ? Number(payload.owner_id)
          : undefined,
      approvedBy:
        payload?.approved_by !== undefined && payload?.approved_by !== null
          ? Number(payload.approved_by)
          : undefined,
      approvedAt: String(payload?.approved_at ?? ''),
      effectiveFrom: String(payload?.effective_from ?? ''),
      reviewDueAt: String(payload?.review_due_at ?? ''),
      createdAt: String(payload?.created_at ?? ''),
      updatedAt: String(payload?.updated_at ?? ''),
    };
  }
}
