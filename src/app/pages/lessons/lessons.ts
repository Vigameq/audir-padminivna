import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import {
  LessonApplicability,
  LessonKpis,
  LessonRecord,
  LessonRiskLevel,
  LessonService,
  LessonSourceType,
  LessonStatus,
} from '../../services/lesson.service';

@Component({
  selector: 'app-lessons',
  imports: [CommonModule, FormsModule],
  templateUrl: './lessons.html',
  styleUrl: './lessons.scss',
})
export class Lessons implements OnInit {
  private readonly lessonService = inject(LessonService);
  private readonly route = inject(ActivatedRoute);

  protected readonly sourceTypeOptions: LessonSourceType[] = ['Manual', 'Audit', 'NC', 'Complaint', 'Change'];
  protected readonly riskOptions: LessonRiskLevel[] = ['Low', 'Medium', 'High', 'Critical'];
  protected readonly applicabilityOptions: LessonApplicability[] = ['Plant', 'Line', 'Product', 'Global'];
  protected readonly statusOptions: LessonStatus[] = ['Draft', 'Published', 'Archived'];

  protected readonly activeStatus = signal<'All' | LessonStatus>('All');
  protected readonly activeSourceType = signal<'All' | LessonSourceType>('All');
  protected readonly searchText = signal('');
  protected readonly filterTag = signal('');
  protected kpis: LessonKpis = {
    draftCount: 0,
    publishedCount: 0,
    archivedCount: 0,
    publishedThisMonth: 0,
    lessonsWithAck: 0,
    totalAckRows: 0,
  };
  protected ackSummary: Record<number, { totalUsers: number; acknowledgedCount: number }> = {};

  protected createForm = {
    title: '',
    summary: '',
    problemStatement: '',
    rootCause: '',
    whatWorked: '',
    whatFailed: '',
    preventiveRecommendation: '',
    standardizationAction: '',
    sourceType: 'Manual' as LessonSourceType,
    sourceRef: '',
    category: '',
    department: '',
    tagsInput: '',
    riskLevel: 'Medium' as LessonRiskLevel,
    applicability: 'Plant' as LessonApplicability,
    status: 'Draft' as LessonStatus,
    effectiveFrom: '',
    reviewDueAt: '',
  };

  protected editDraft: Record<number, Partial<LessonRecord>> = {};
  protected saving = false;
  protected saveError = '';

  protected readonly lessons = computed(() => this.lessonService.lessons());

  ngOnInit(): void {
    this.refreshLessons();
    this.route.queryParamMap.subscribe((params) => {
      const sourceType = String(params.get('source_type') ?? '').trim() as LessonSourceType;
      const sourceRef = String(params.get('source_ref') ?? '').trim();
      if (['Audit', 'NC', 'Complaint', 'Change', 'Manual'].includes(sourceType)) {
        this.createForm.sourceType = sourceType;
      }
      if (sourceRef) {
        this.createForm.sourceRef = sourceRef;
      }
      const title = String(params.get('title') ?? '').trim();
      if (title) {
        this.createForm.title = title;
      }
    });
    this.lessonService.getKpis().subscribe({
      next: (kpis) => {
        this.kpis = kpis;
      },
    });
  }

  protected refreshLessons(): void {
    this.lessonService
      .listLessons({
        status: this.activeStatus(),
        sourceType: this.activeSourceType(),
        q: this.searchText(),
        tag: this.filterTag(),
      })
      .subscribe();
  }

  protected setStatus(status: 'All' | LessonStatus): void {
    this.activeStatus.set(status);
    this.refreshLessons();
  }

  protected setSourceType(sourceType: 'All' | LessonSourceType): void {
    this.activeSourceType.set(sourceType);
    this.refreshLessons();
  }

  protected onSearchChange(value: string): void {
    this.searchText.set(value);
  }

  protected onTagChange(value: string): void {
    this.filterTag.set(value);
  }

  protected applySearch(): void {
    this.refreshLessons();
  }

  protected createLesson(): void {
    const title = this.createForm.title.trim();
    if (!title || this.saving) {
      return;
    }
    this.saving = true;
    this.saveError = '';
    const tags = this.createForm.tagsInput
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    this.lessonService
      .createLesson({
        title,
        summary: this.createForm.summary.trim() || null,
        problem_statement: this.createForm.problemStatement.trim() || null,
        root_cause: this.createForm.rootCause.trim() || null,
        what_worked: this.createForm.whatWorked.trim() || null,
        what_failed: this.createForm.whatFailed.trim() || null,
        preventive_recommendation: this.createForm.preventiveRecommendation.trim() || null,
        standardization_action: this.createForm.standardizationAction.trim() || null,
        source_type: this.createForm.sourceType,
        source_ref: this.createForm.sourceRef.trim() || null,
        category: this.createForm.category.trim() || null,
        department: this.createForm.department.trim() || null,
        tags,
        risk_level: this.createForm.riskLevel,
        applicability: this.createForm.applicability,
        status: this.createForm.status,
        effective_from: this.createForm.effectiveFrom || null,
        review_due_at: this.createForm.reviewDueAt || null,
      })
      .subscribe({
        next: () => {
          this.createForm = {
            title: '',
            summary: '',
            problemStatement: '',
            rootCause: '',
            whatWorked: '',
            whatFailed: '',
            preventiveRecommendation: '',
            standardizationAction: '',
            sourceType: 'Manual',
            sourceRef: '',
            category: '',
            department: '',
            tagsInput: '',
            riskLevel: 'Medium',
            applicability: 'Plant',
            status: 'Draft',
            effectiveFrom: '',
            reviewDueAt: '',
          };
          this.saving = false;
          this.lessonService.getKpis().subscribe({
            next: (kpis) => {
              this.kpis = kpis;
            },
          });
        },
        error: () => {
          this.saving = false;
          this.saveError = 'Unable to create lesson. Please try again.';
        },
      });
  }

  protected startEdit(record: LessonRecord): void {
    this.editDraft[record.id] = {
      status: record.status,
      summary: record.summary,
      preventiveRecommendation: record.preventiveRecommendation,
      standardizationAction: record.standardizationAction,
      reviewDueAt: record.reviewDueAt,
    };
  }

  protected cancelEdit(id: number): void {
    delete this.editDraft[id];
  }

  protected hasEditDraft(id: number): boolean {
    return !!this.editDraft[id];
  }

  protected saveLesson(record: LessonRecord): void {
    const draft = this.editDraft[record.id];
    if (!draft) {
      return;
    }
    this.lessonService
      .updateLesson(record.id, {
        status: (draft.status as LessonStatus) ?? record.status,
        summary: (draft.summary ?? record.summary ?? '').trim() || null,
        preventive_recommendation:
          (draft.preventiveRecommendation ?? record.preventiveRecommendation ?? '').trim() || null,
        standardization_action:
          (draft.standardizationAction ?? record.standardizationAction ?? '').trim() || null,
        review_due_at: (draft.reviewDueAt ?? record.reviewDueAt ?? '').trim() || null,
      })
      .subscribe({
        next: () => {
          delete this.editDraft[record.id];
        },
      });
  }

  protected patchDraft(id: number, key: keyof LessonRecord, value: unknown): void {
    this.editDraft[id] = {
      ...(this.editDraft[id] ?? {}),
      [key]: value,
    };
  }

  protected publish(record: LessonRecord): void {
    this.lessonService.publishLesson(record.id).subscribe({
      next: () => {
        this.refreshLessons();
        this.lessonService.getKpis().subscribe({
          next: (kpis) => {
            this.kpis = kpis;
          },
        });
      },
    });
  }

  protected archive(record: LessonRecord): void {
    this.lessonService.archiveLesson(record.id).subscribe({
      next: () => {
        this.refreshLessons();
        this.lessonService.getKpis().subscribe({
          next: (kpis) => {
            this.kpis = kpis;
          },
        });
      },
    });
  }

  protected acknowledge(record: LessonRecord): void {
    this.lessonService.acknowledgeLesson(record.id).subscribe({
      next: () => {
        this.loadAckStatus(record.id);
        this.lessonService.getKpis().subscribe({
          next: (kpis) => {
            this.kpis = kpis;
          },
        });
      },
    });
  }

  protected loadAckStatus(lessonId: number): void {
    this.lessonService.getAcknowledgementStatus(lessonId).subscribe({
      next: (result) => {
        this.ackSummary[lessonId] = {
          totalUsers: result.totalUsers,
          acknowledgedCount: result.acknowledgedCount,
        };
      },
    });
  }
}
