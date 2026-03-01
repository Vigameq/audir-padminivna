import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Observable, map, tap } from 'rxjs';

export type SupplierStatus = 'Active' | 'Inactive' | 'Blocked';
export type PpapApprovalStatus = 'Pending' | 'Approved' | 'Rejected';
export type SupplierAuditStatus = 'Planned' | 'In Progress' | 'Closed';

export type SupplierRecord = {
  id: number;
  code: string;
  name: string;
  category: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  status: SupplierStatus;
  createdAt: string;
  updatedAt: string;
};

export type SupplierPpapRecord = {
  id: number;
  supplierId: number;
  supplierCode: string;
  supplierName: string;
  partNo: string;
  level: string;
  submissionDate: string;
  approvalStatus: PpapApprovalStatus;
  approvedBy: string;
  approvedAt: string;
  remarks: string;
  documents: SupplierPpapDocument[];
  createdAt: string;
  updatedAt: string;
};

export type SupplierPpapDocument = {
  id: number;
  ppapId: number;
  fileName: string;
  fileKey: string;
  fileUrl: string;
  createdAt: string;
};

export type SupplierPerformanceRecord = {
  id: number;
  supplierId: number;
  supplierCode: string;
  supplierName: string;
  periodMonth: string;
  qualityScore: number;
  deliveryScore: number;
  serviceScore: number;
  totalScore: number;
  remarks: string;
  createdAt: string;
  updatedAt: string;
};

export type SupplierPpmRecord = {
  id: number;
  supplierId: number;
  supplierCode: string;
  supplierName: string;
  periodMonth: string;
  deliveredQty: number;
  defectiveQty: number;
  ppm: number;
  remarks: string;
  createdAt: string;
  updatedAt: string;
};

export type SupplierAuditRecord = {
  id: number;
  supplierId: number;
  supplierCode: string;
  supplierName: string;
  auditDate: string;
  auditType: string;
  auditorName: string;
  score: number;
  status: SupplierAuditStatus;
  findings: string;
  actionOwner: string;
  targetCloseDate: string;
  createdAt: string;
  updatedAt: string;
};

export type WorstSupplierRecord = {
  id: number;
  code: string;
  name: string;
  avgPpm: number;
  avgTotalScore: number;
  riskIndex: number;
  latestAuditStatus: string;
  latestAuditDate: string;
};

export type SupplierMonthlyPpmTrend = {
  label: string;
  avgPpm: number;
};

export type SupplierPpapAging = {
  bucket0to7: number;
  bucket8to15: number;
  bucket16to30: number;
  bucketGt30: number;
};

export type SupplierDashboardKpis = {
  totalSuppliers: number;
  activeSuppliers: number;
  pendingPpap: number;
  openSupplierAudits: number;
};

export type SupplierDashboardSummary = {
  kpis: SupplierDashboardKpis;
  monthlyPpmTrend: SupplierMonthlyPpmTrend[];
  topWorstSuppliers: WorstSupplierRecord[];
  ppapApprovalAging: SupplierPpapAging;
};

@Injectable({ providedIn: 'root' })
export class SupplierService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = '/api';

  private readonly suppliersSignal = signal<SupplierRecord[]>([]);
  private readonly ppapSignal = signal<SupplierPpapRecord[]>([]);
  private readonly performanceSignal = signal<SupplierPerformanceRecord[]>([]);
  private readonly ppmSignal = signal<SupplierPpmRecord[]>([]);
  private readonly auditsSignal = signal<SupplierAuditRecord[]>([]);
  private readonly worstSuppliersSignal = signal<WorstSupplierRecord[]>([]);
  private readonly dashboardSummarySignal = signal<SupplierDashboardSummary>({
    kpis: {
      totalSuppliers: 0,
      activeSuppliers: 0,
      pendingPpap: 0,
      openSupplierAudits: 0,
    },
    monthlyPpmTrend: [],
    topWorstSuppliers: [],
    ppapApprovalAging: {
      bucket0to7: 0,
      bucket8to15: 0,
      bucket16to30: 0,
      bucketGt30: 0,
    },
  });

  readonly suppliers = this.suppliersSignal.asReadonly();
  readonly ppap = this.ppapSignal.asReadonly();
  readonly performance = this.performanceSignal.asReadonly();
  readonly ppm = this.ppmSignal.asReadonly();
  readonly audits = this.auditsSignal.asReadonly();
  readonly worstSuppliers = this.worstSuppliersSignal.asReadonly();
  readonly dashboardSummary = this.dashboardSummarySignal.asReadonly();

  listSuppliers(): Observable<SupplierRecord[]> {
    return this.http.get<unknown[]>(`${this.baseUrl}/suppliers`).pipe(
      map((rows) => (Array.isArray(rows) ? rows.map((row) => this.mapSupplier(row)) : [])),
      tap((rows) => this.suppliersSignal.set(rows))
    );
  }

  createSupplier(payload: {
    name: string;
    category?: string | null;
    contact_name?: string | null;
    contact_email?: string | null;
    contact_phone?: string | null;
    status?: SupplierStatus;
  }): Observable<SupplierRecord> {
    return this.http.post<unknown>(`${this.baseUrl}/suppliers`, payload).pipe(
      map((row) => this.mapSupplier(row)),
      tap((record) => this.suppliersSignal.set([record, ...this.suppliersSignal()]))
    );
  }

  updateSupplier(id: number, payload: {
    name?: string;
    category?: string | null;
    contact_name?: string | null;
    contact_email?: string | null;
    contact_phone?: string | null;
    status?: SupplierStatus;
  }): Observable<SupplierRecord> {
    return this.http.put<unknown>(`${this.baseUrl}/suppliers/${id}`, payload).pipe(
      map((row) => this.mapSupplier(row)),
      tap((updated) => {
        this.suppliersSignal.set(this.suppliersSignal().map((row) => (row.id === updated.id ? updated : row)));
      })
    );
  }

  listPpap(): Observable<SupplierPpapRecord[]> {
    return this.http.get<unknown[]>(`${this.baseUrl}/supplier-ppap`).pipe(
      map((rows) => (Array.isArray(rows) ? rows.map((row) => this.mapPpap(row)) : [])),
      tap((rows) => this.ppapSignal.set(rows))
    );
  }

  createPpap(payload: {
    supplier_id: number;
    part_no?: string | null;
    level?: string;
    submission_date?: string | null;
    approval_status?: PpapApprovalStatus;
    approved_by?: string | null;
    remarks?: string | null;
  }): Observable<SupplierPpapRecord> {
    return this.http.post<unknown>(`${this.baseUrl}/supplier-ppap`, payload).pipe(
      map((row) => this.mapPpap(row)),
      tap(() => this.listPpap().subscribe())
    );
  }

  updatePpap(id: number, payload: {
    part_no?: string;
    level?: string;
    submission_date?: string | null;
    approval_status?: PpapApprovalStatus;
    approved_by?: string | null;
    remarks?: string | null;
  }): Observable<SupplierPpapRecord> {
    return this.http.put<unknown>(`${this.baseUrl}/supplier-ppap/${id}`, payload).pipe(
      map((row) => this.mapPpap(row)),
      tap(() => this.listPpap().subscribe())
    );
  }

  getPpapDocumentUploadUrls(payload: {
    ppap_id: number;
    files: { name: string; type: string }[];
  }): Observable<{
    folderUrl: string;
    uploads: { name: string; key: string; uploadUrl: string; publicUrl: string }[];
  }> {
    return this.http.post<{
      folderUrl: string;
      uploads: { name: string; key: string; uploadUrl: string; publicUrl: string }[];
    }>(`${this.baseUrl}/supplier-ppap/${payload.ppap_id}/documents/presign`, {
      files: payload.files,
    });
  }

  addPpapDocuments(payload: {
    ppap_id: number;
    documents: { name: string; key: string; url: string }[];
  }): Observable<SupplierPpapDocument[]> {
    return this.http
      .post<unknown[]>(`${this.baseUrl}/supplier-ppap/${payload.ppap_id}/documents`, {
        documents: payload.documents,
      })
      .pipe(
        map((rows) => (Array.isArray(rows) ? rows.map((row) => this.mapPpapDocument(row)) : [])),
        tap(() => this.listPpap().subscribe())
      );
  }

  getPpapDocumentDownloadUrl(ppapId: number, documentId: number): Observable<{ url: string }> {
    return this.http.get<{ url: string }>(`${this.baseUrl}/supplier-ppap/${ppapId}/documents/${documentId}/presign-read`);
  }

  deletePpapDocument(ppapId: number, documentId: number): Observable<{ ok: boolean }> {
    return this.http
      .delete<{ ok: boolean }>(`${this.baseUrl}/supplier-ppap/${ppapId}/documents/${documentId}`)
      .pipe(tap(() => this.listPpap().subscribe()));
  }

  listPerformance(): Observable<SupplierPerformanceRecord[]> {
    return this.http.get<unknown[]>(`${this.baseUrl}/supplier-performance`).pipe(
      map((rows) => (Array.isArray(rows) ? rows.map((row) => this.mapPerformance(row)) : [])),
      tap((rows) => this.performanceSignal.set(rows))
    );
  }

  createPerformance(payload: {
    supplier_id: number;
    period_month: string;
    quality_score?: number;
    delivery_score?: number;
    service_score?: number;
    remarks?: string | null;
  }): Observable<SupplierPerformanceRecord> {
    return this.http.post<unknown>(`${this.baseUrl}/supplier-performance`, payload).pipe(
      map((row) => this.mapPerformance(row)),
      tap(() => this.listPerformance().subscribe())
    );
  }

  updatePerformance(id: number, payload: {
    period_month?: string;
    quality_score?: number;
    delivery_score?: number;
    service_score?: number;
    remarks?: string | null;
  }): Observable<SupplierPerformanceRecord> {
    return this.http.put<unknown>(`${this.baseUrl}/supplier-performance/${id}`, payload).pipe(
      map((row) => this.mapPerformance(row)),
      tap(() => this.listPerformance().subscribe())
    );
  }

  listPpm(): Observable<SupplierPpmRecord[]> {
    return this.http.get<unknown[]>(`${this.baseUrl}/supplier-ppm`).pipe(
      map((rows) => (Array.isArray(rows) ? rows.map((row) => this.mapPpm(row)) : [])),
      tap((rows) => this.ppmSignal.set(rows))
    );
  }

  createPpm(payload: {
    supplier_id: number;
    period_month: string;
    delivered_qty: number;
    defective_qty: number;
    remarks?: string | null;
  }): Observable<SupplierPpmRecord> {
    return this.http.post<unknown>(`${this.baseUrl}/supplier-ppm`, payload).pipe(
      map((row) => this.mapPpm(row)),
      tap(() => this.listPpm().subscribe())
    );
  }

  updatePpm(id: number, payload: {
    period_month?: string;
    delivered_qty?: number;
    defective_qty?: number;
    remarks?: string | null;
  }): Observable<SupplierPpmRecord> {
    return this.http.put<unknown>(`${this.baseUrl}/supplier-ppm/${id}`, payload).pipe(
      map((row) => this.mapPpm(row)),
      tap(() => this.listPpm().subscribe())
    );
  }

  listAudits(): Observable<SupplierAuditRecord[]> {
    return this.http.get<unknown[]>(`${this.baseUrl}/supplier-audits`).pipe(
      map((rows) => (Array.isArray(rows) ? rows.map((row) => this.mapAudit(row)) : [])),
      tap((rows) => this.auditsSignal.set(rows))
    );
  }

  createAudit(payload: {
    supplier_id: number;
    audit_date: string;
    audit_type?: string | null;
    auditor_name?: string | null;
    score?: number | null;
    status?: SupplierAuditStatus;
    findings?: string | null;
    action_owner?: string | null;
    target_close_date?: string | null;
  }): Observable<SupplierAuditRecord> {
    return this.http.post<unknown>(`${this.baseUrl}/supplier-audits`, payload).pipe(
      map((row) => this.mapAudit(row)),
      tap(() => this.listAudits().subscribe())
    );
  }

  updateAudit(id: number, payload: {
    audit_date?: string;
    audit_type?: string | null;
    auditor_name?: string | null;
    score?: number | null;
    status?: SupplierAuditStatus;
    findings?: string | null;
    action_owner?: string | null;
    target_close_date?: string | null;
  }): Observable<SupplierAuditRecord> {
    return this.http.put<unknown>(`${this.baseUrl}/supplier-audits/${id}`, payload).pipe(
      map((row) => this.mapAudit(row)),
      tap(() => this.listAudits().subscribe())
    );
  }

  listWorstSuppliers(limit = 10): Observable<WorstSupplierRecord[]> {
    return this.http.get<unknown[]>(`${this.baseUrl}/supplier-worst?limit=${limit}`).pipe(
      map((rows) => (Array.isArray(rows) ? rows.map((row) => this.mapWorstSupplier(row)) : [])),
      tap((rows) => this.worstSuppliersSignal.set(rows))
    );
  }

  listDashboardSummary(): Observable<SupplierDashboardSummary> {
    return this.http.get<unknown>(`${this.baseUrl}/supplier-dashboard`).pipe(
      map((payload) => this.mapDashboardSummary(payload)),
      tap((summary) => {
        this.dashboardSummarySignal.set(summary);
        this.worstSuppliersSignal.set(summary.topWorstSuppliers);
      })
    );
  }

  private mapSupplier(payload: any): SupplierRecord {
    return {
      id: Number(payload?.id ?? 0),
      code: String(payload?.code ?? ''),
      name: String(payload?.name ?? ''),
      category: String(payload?.category ?? ''),
      contactName: String(payload?.contact_name ?? ''),
      contactEmail: String(payload?.contact_email ?? ''),
      contactPhone: String(payload?.contact_phone ?? ''),
      status: String(payload?.status ?? 'Active') as SupplierStatus,
      createdAt: String(payload?.created_at ?? ''),
      updatedAt: String(payload?.updated_at ?? ''),
    };
  }

  private mapPpap(payload: any): SupplierPpapRecord {
    return {
      id: Number(payload?.id ?? 0),
      supplierId: Number(payload?.supplier_id ?? 0),
      supplierCode: String(payload?.supplier_code ?? ''),
      supplierName: String(payload?.supplier_name ?? ''),
      partNo: String(payload?.part_no ?? ''),
      level: String(payload?.level ?? ''),
      submissionDate: String(payload?.submission_date ?? ''),
      approvalStatus: String(payload?.approval_status ?? 'Pending') as PpapApprovalStatus,
      approvedBy: String(payload?.approved_by ?? ''),
      approvedAt: String(payload?.approved_at ?? ''),
      remarks: String(payload?.remarks ?? ''),
      documents: Array.isArray(payload?.documents)
        ? payload.documents.map((row: unknown) => this.mapPpapDocument(row))
        : [],
      createdAt: String(payload?.created_at ?? ''),
      updatedAt: String(payload?.updated_at ?? ''),
    };
  }

  private mapPpapDocument(payload: any): SupplierPpapDocument {
    return {
      id: Number(payload?.id ?? 0),
      ppapId: Number(payload?.ppap_id ?? 0),
      fileName: String(payload?.file_name ?? ''),
      fileKey: String(payload?.file_key ?? ''),
      fileUrl: String(payload?.file_url ?? ''),
      createdAt: String(payload?.created_at ?? ''),
    };
  }

  private mapPerformance(payload: any): SupplierPerformanceRecord {
    return {
      id: Number(payload?.id ?? 0),
      supplierId: Number(payload?.supplier_id ?? 0),
      supplierCode: String(payload?.supplier_code ?? ''),
      supplierName: String(payload?.supplier_name ?? ''),
      periodMonth: String(payload?.period_month ?? ''),
      qualityScore: Number(payload?.quality_score ?? 0),
      deliveryScore: Number(payload?.delivery_score ?? 0),
      serviceScore: Number(payload?.service_score ?? 0),
      totalScore: Number(payload?.total_score ?? 0),
      remarks: String(payload?.remarks ?? ''),
      createdAt: String(payload?.created_at ?? ''),
      updatedAt: String(payload?.updated_at ?? ''),
    };
  }

  private mapPpm(payload: any): SupplierPpmRecord {
    return {
      id: Number(payload?.id ?? 0),
      supplierId: Number(payload?.supplier_id ?? 0),
      supplierCode: String(payload?.supplier_code ?? ''),
      supplierName: String(payload?.supplier_name ?? ''),
      periodMonth: String(payload?.period_month ?? ''),
      deliveredQty: Number(payload?.delivered_qty ?? 0),
      defectiveQty: Number(payload?.defective_qty ?? 0),
      ppm: Number(payload?.ppm ?? 0),
      remarks: String(payload?.remarks ?? ''),
      createdAt: String(payload?.created_at ?? ''),
      updatedAt: String(payload?.updated_at ?? ''),
    };
  }

  private mapAudit(payload: any): SupplierAuditRecord {
    return {
      id: Number(payload?.id ?? 0),
      supplierId: Number(payload?.supplier_id ?? 0),
      supplierCode: String(payload?.supplier_code ?? ''),
      supplierName: String(payload?.supplier_name ?? ''),
      auditDate: String(payload?.audit_date ?? ''),
      auditType: String(payload?.audit_type ?? ''),
      auditorName: String(payload?.auditor_name ?? ''),
      score: Number(payload?.score ?? 0),
      status: String(payload?.status ?? 'Planned') as SupplierAuditStatus,
      findings: String(payload?.findings ?? ''),
      actionOwner: String(payload?.action_owner ?? ''),
      targetCloseDate: String(payload?.target_close_date ?? ''),
      createdAt: String(payload?.created_at ?? ''),
      updatedAt: String(payload?.updated_at ?? ''),
    };
  }

  private mapWorstSupplier(payload: any): WorstSupplierRecord {
    return {
      id: Number(payload?.id ?? 0),
      code: String(payload?.code ?? ''),
      name: String(payload?.name ?? ''),
      avgPpm: Number(payload?.avg_ppm ?? 0),
      avgTotalScore: Number(payload?.avg_total_score ?? 0),
      riskIndex: Number(payload?.risk_index ?? 0),
      latestAuditStatus: String(payload?.latest_audit_status ?? ''),
      latestAuditDate: String(payload?.latest_audit_date ?? ''),
    };
  }

  private mapDashboardSummary(payload: any): SupplierDashboardSummary {
    const kpis = payload?.kpis ?? {};
    const trend = Array.isArray(payload?.monthly_ppm_trend) ? payload.monthly_ppm_trend : [];
    const topWorst = Array.isArray(payload?.top_worst_suppliers) ? payload.top_worst_suppliers : [];
    const aging = payload?.ppap_approval_aging ?? {};
    return {
      kpis: {
        totalSuppliers: Number(kpis?.total_suppliers ?? 0),
        activeSuppliers: Number(kpis?.active_suppliers ?? 0),
        pendingPpap: Number(kpis?.pending_ppap ?? 0),
        openSupplierAudits: Number(kpis?.open_supplier_audits ?? 0),
      },
      monthlyPpmTrend: trend.map((row: any) => ({
        label: String(row?.label ?? ''),
        avgPpm: Number(row?.avg_ppm ?? 0),
      })),
      topWorstSuppliers: topWorst.map((row: any) => this.mapWorstSupplier(row)),
      ppapApprovalAging: {
        bucket0to7: Number(aging?.bucket_0_7 ?? 0),
        bucket8to15: Number(aging?.bucket_8_15 ?? 0),
        bucket16to30: Number(aging?.bucket_16_30 ?? 0),
        bucketGt30: Number(aging?.bucket_gt_30 ?? 0),
      },
    };
  }
}
