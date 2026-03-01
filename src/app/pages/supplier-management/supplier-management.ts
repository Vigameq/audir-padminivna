import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom, forkJoin } from 'rxjs';
import {
  SupplierAuditStatus,
  SupplierDashboardSummary,
  SupplierService,
  SupplierStatus,
} from '../../services/supplier.service';

@Component({
  selector: 'app-supplier-management',
  imports: [CommonModule, FormsModule],
  templateUrl: './supplier-management.html',
  styleUrl: './supplier-management.scss',
})
export class SupplierManagement implements OnInit {
  private readonly supplierService = inject(SupplierService);
  private readonly defaultDashboardSummary: SupplierDashboardSummary = {
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
  };

  protected readonly tab = signal<'dashboard' | 'master' | 'ppap' | 'performance' | 'ppm' | 'worst' | 'audits'>('dashboard');
  protected readonly supplierStatusOptions: SupplierStatus[] = ['Active', 'Inactive', 'Blocked'];
  protected readonly ppapLevelOptions: string[] = [
    'Level 1 (Warranty only)',
    'Level 2 (Warrant + Limited samples)',
    'Level 3 (Full PPAP package)',
    'Level 4 (Customer-specific requirements)',
    'Level 5 (On-site review)',
  ];
  protected readonly auditStatusOptions: SupplierAuditStatus[] = ['Planned', 'In Progress', 'Closed'];

  protected readonly suppliers = computed(() => this.supplierService.suppliers());
  protected readonly ppap = computed(() => this.supplierService.ppap());
  protected readonly performance = computed(() => this.supplierService.performance());
  protected readonly ppm = computed(() => this.supplierService.ppm());
  protected readonly audits = computed(() => this.supplierService.audits());
  protected readonly worstSuppliers = computed(() => this.supplierService.worstSuppliers());
  protected readonly dashboardSummary = computed(() => this.supplierService.dashboardSummary() ?? this.defaultDashboardSummary);

  protected loading = false;
  protected error = '';

  protected supplierForm = {
    name: '',
    category: '',
    contactName: '',
    contactEmail: '',
    contactPhone: '',
    status: 'Active' as SupplierStatus,
  };

  protected ppapForm = {
    supplierId: 0,
    level: 'Level 3 (Full PPAP package)',
    submissionDate: '',
    remarks: '',
  };
  protected createPpapFiles: File[] = [];
  protected ppapRecordFiles: Record<number, File[]> = {};
  protected uploadingPpapDocs: Record<number, boolean> = {};

  protected performanceForm = {
    supplierId: 0,
    periodMonth: '',
    qualityScore: 0,
    deliveryScore: 0,
    serviceScore: 0,
    remarks: '',
  };

  protected ppmForm = {
    supplierId: 0,
    periodMonth: '',
    deliveredQty: 0,
    defectiveQty: 0,
    remarks: '',
  };

  protected auditForm = {
    supplierId: 0,
    auditDate: '',
    auditType: 'System',
    auditorName: '',
    score: 0,
    status: 'Planned' as SupplierAuditStatus,
    findings: '',
    actionOwner: '',
    targetCloseDate: '',
  };

  protected supplierEditDraft: Record<number, { status: SupplierStatus }> = {};
  protected auditEditDraft: Record<number, { status: SupplierAuditStatus }> = {};

  ngOnInit(): void {
    this.refreshAll();
  }

  protected setTab(next: 'dashboard' | 'master' | 'ppap' | 'performance' | 'ppm' | 'worst' | 'audits'): void {
    this.tab.set(next);
    if (next === 'dashboard' || next === 'worst') {
      this.supplierService.listDashboardSummary().subscribe();
    }
  }

  protected recalculateWorstSuppliers(): void {
    this.supplierService.listDashboardSummary().subscribe();
  }

  protected refreshAll(): void {
    this.loading = true;
    this.error = '';
    forkJoin([
      this.supplierService.listSuppliers(),
      this.supplierService.listPpap(),
      this.supplierService.listPerformance(),
      this.supplierService.listPpm(),
      this.supplierService.listAudits(),
      this.supplierService.listDashboardSummary(),
    ]).subscribe({
      next: () => {
        this.loading = false;
      },
      error: () => {
        this.loading = false;
        this.error = 'Unable to load supplier management data.';
      },
    });
  }

  protected createSupplier(): void {
    const name = this.supplierForm.name.trim();
    if (!name) {
      return;
    }
    this.supplierService
      .createSupplier({
        name,
        category: this.supplierForm.category.trim() || null,
        contact_name: this.supplierForm.contactName.trim() || null,
        contact_email: this.supplierForm.contactEmail.trim() || null,
        contact_phone: this.supplierForm.contactPhone.trim() || null,
        status: this.supplierForm.status,
      })
      .subscribe({
        next: () => {
          this.supplierForm = {
            name: '',
            category: '',
            contactName: '',
            contactEmail: '',
            contactPhone: '',
            status: 'Active',
          };
          this.supplierService.listDashboardSummary().subscribe();
        },
      });
  }

  protected patchSupplierStatus(id: number, status: SupplierStatus): void {
    this.supplierEditDraft[id] = { status };
  }

  protected saveSupplierStatus(id: number): void {
    const draft = this.supplierEditDraft[id];
    if (!draft) {
      return;
    }
    this.supplierService.updateSupplier(id, { status: draft.status }).subscribe({
      next: () => {
        delete this.supplierEditDraft[id];
        this.supplierService.listDashboardSummary().subscribe();
      },
    });
  }

  protected createPpap(): void {
    if (!this.ppapForm.supplierId) {
      return;
    }
    this.supplierService
      .createPpap({
        supplier_id: this.ppapForm.supplierId,
        level: this.ppapForm.level.trim() || this.ppapLevelOptions[2],
        submission_date: this.ppapForm.submissionDate || null,
        remarks: this.ppapForm.remarks.trim() || null,
      })
      .subscribe({
        next: async (record) => {
          try {
            if (this.createPpapFiles.length) {
              await this.uploadPpapFiles(record.id, this.createPpapFiles);
            }
          } catch {
            window.alert('PPAP created, but document upload failed.');
          }
          this.ppapForm = {
            supplierId: 0,
            level: this.ppapLevelOptions[2],
            submissionDate: '',
            remarks: '',
          };
          this.createPpapFiles = [];
          this.supplierService.listDashboardSummary().subscribe();
        },
      });
  }

  protected onCreatePpapFilesSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    this.createPpapFiles = files;
  }

  protected onPpapRecordFilesSelected(ppapId: number, event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    this.ppapRecordFiles[ppapId] = files;
  }

  protected async uploadPpapDocuments(ppapId: number): Promise<void> {
    const files = this.ppapRecordFiles[ppapId] ?? [];
    if (!files.length) {
      return;
    }
    try {
      await this.uploadPpapFiles(ppapId, files);
    } catch {
      window.alert('Unable to upload PPAP documents. Please try again.');
    }
    this.ppapRecordFiles[ppapId] = [];
  }

  protected deletePpapDocument(ppapId: number, documentId: number): void {
    this.supplierService.deletePpapDocument(ppapId, documentId).subscribe();
  }

  protected createPerformance(): void {
    if (!this.performanceForm.supplierId || !this.performanceForm.periodMonth) {
      return;
    }
    this.supplierService
      .createPerformance({
        supplier_id: this.performanceForm.supplierId,
        period_month: this.performanceForm.periodMonth,
        quality_score: Number(this.performanceForm.qualityScore) || 0,
        delivery_score: Number(this.performanceForm.deliveryScore) || 0,
        service_score: Number(this.performanceForm.serviceScore) || 0,
        remarks: this.performanceForm.remarks.trim() || null,
      })
      .subscribe({
        next: () => {
          this.performanceForm = {
            supplierId: 0,
            periodMonth: '',
            qualityScore: 0,
            deliveryScore: 0,
            serviceScore: 0,
            remarks: '',
          };
          this.supplierService.listDashboardSummary().subscribe();
        },
      });
  }

  protected createPpm(): void {
    if (!this.ppmForm.supplierId || !this.ppmForm.periodMonth) {
      return;
    }
    if (this.ppmForm.defectiveQty > this.ppmForm.deliveredQty) {
      return;
    }
    this.supplierService
      .createPpm({
        supplier_id: this.ppmForm.supplierId,
        period_month: this.ppmForm.periodMonth,
        delivered_qty: Math.max(0, Math.floor(Number(this.ppmForm.deliveredQty) || 0)),
        defective_qty: Math.max(0, Math.floor(Number(this.ppmForm.defectiveQty) || 0)),
        remarks: this.ppmForm.remarks.trim() || null,
      })
      .subscribe({
        next: () => {
          this.ppmForm = {
            supplierId: 0,
            periodMonth: '',
            deliveredQty: 0,
            defectiveQty: 0,
            remarks: '',
          };
          this.supplierService.listDashboardSummary().subscribe();
        },
      });
  }

  protected createAudit(): void {
    if (!this.auditForm.supplierId || !this.auditForm.auditDate) {
      return;
    }
    this.supplierService
      .createAudit({
        supplier_id: this.auditForm.supplierId,
        audit_date: this.auditForm.auditDate,
        audit_type: this.auditForm.auditType.trim() || null,
        auditor_name: this.auditForm.auditorName.trim() || null,
        score: Number(this.auditForm.score) || null,
        status: this.auditForm.status,
        findings: this.auditForm.findings.trim() || null,
        action_owner: this.auditForm.actionOwner.trim() || null,
        target_close_date: this.auditForm.targetCloseDate || null,
      })
      .subscribe({
        next: () => {
          this.auditForm = {
            supplierId: 0,
            auditDate: '',
            auditType: 'System',
            auditorName: '',
            score: 0,
            status: 'Planned',
            findings: '',
            actionOwner: '',
            targetCloseDate: '',
          };
          this.supplierService.listDashboardSummary().subscribe();
        },
      });
  }

  protected patchAuditStatus(id: number, status: SupplierAuditStatus): void {
    this.auditEditDraft[id] = { status };
  }

  protected saveAuditStatus(id: number): void {
    const draft = this.auditEditDraft[id];
    if (!draft) {
      return;
    }
    this.supplierService.updateAudit(id, { status: draft.status }).subscribe({
      next: () => {
        delete this.auditEditDraft[id];
        this.supplierService.listDashboardSummary().subscribe();
      },
    });
  }

  protected ppmTrendHeight(value: number): string {
    const trend = this.dashboardSummary().monthlyPpmTrend;
    const max = Math.max(1, ...trend.map((item) => item.avgPpm));
    const normalized = Math.max(0, value / max);
    return `${Math.max(8, Math.round(normalized * 100))}%`;
  }

  protected worstSupplierWidth(value: number): string {
    const rows = this.dashboardSummary().topWorstSuppliers;
    const max = Math.max(1, ...rows.map((item) => item.riskIndex));
    const normalized = Math.max(0, value / max);
    return `${Math.max(5, Math.round(normalized * 100))}%`;
  }

  protected ppapAgingWidth(value: number): string {
    const aging = this.dashboardSummary().ppapApprovalAging;
    const max = Math.max(1, aging.bucket0to7, aging.bucket8to15, aging.bucket16to30, aging.bucketGt30);
    const normalized = Math.max(0, value / max);
    return `${Math.max(5, Math.round(normalized * 100))}%`;
  }

  private async uploadPpapFiles(ppapId: number, files: File[]): Promise<void> {
    if (!files.length) {
      return;
    }
    this.uploadingPpapDocs[ppapId] = true;
    try {
      const presign = await firstValueFrom(
        this.supplierService.getPpapDocumentUploadUrls({
          ppap_id: ppapId,
          files: files.map((file) => ({ name: file.name, type: file.type || 'application/octet-stream' })),
        })
      );
      const uploaded: { name: string; key: string; url: string }[] = [];
      for (let index = 0; index < presign.uploads.length; index += 1) {
        const upload = presign.uploads[index];
        const file = files[index];
        const response = await fetch(upload.uploadUrl, {
          method: 'PUT',
          headers: {
            'Content-Type': file.type || 'application/octet-stream',
          },
          body: file,
        });
        if (!response.ok) {
          throw new Error(`Upload failed for ${file.name}`);
        }
        uploaded.push({
          name: file.name,
          key: upload.key,
          url: upload.publicUrl,
        });
      }
      if (uploaded.length) {
        await firstValueFrom(
          this.supplierService.addPpapDocuments({
            ppap_id: ppapId,
            documents: uploaded,
          })
        );
      }
    } finally {
      this.uploadingPpapDocs[ppapId] = false;
    }
  }
}
