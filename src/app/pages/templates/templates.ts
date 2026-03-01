import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import * as XLSX from 'xlsx';
import { TemplateRecord, TemplateService } from '../../services/template.service';

type TemplateSubsection = { id: string; name: string; questionIndices: number[] };

@Component({
  selector: 'app-templates',
  imports: [CommonModule, FormsModule],
  templateUrl: './templates.html',
  styleUrl: './templates.scss',
})
export class Templates implements OnInit {
  private readonly templateService = inject(TemplateService);

  protected isImporting = false;
  protected importError = '';
  protected importNote = '';
  protected noteChars = 0;
  protected showImportModal = false;
  protected templateName = '';
  protected createError = '';
  protected expandedTemplateId: string | null = null;
  protected selectedFileName = '';
  protected editingTemplateId: string | null = null;
  protected editName = '';
  protected editQuestions: string[] = [];
  protected editSubsections: TemplateSubsection[] = [];
  protected editError = '';
  protected subsectionDraftName = '';
  protected importSelectedQuestions: Record<number, boolean> = {};
  protected importSubsections: TemplateSubsection[] = [];
  protected editSubsectionDraftName = '';
  protected editSelectedQuestions: Record<number, boolean> = {};
  protected draggingEditQuestionIndex: number | null = null;
  protected draggingSubsectionId: string | null = null;
  protected draggingQuestion: { sectionId: string; questionIndex: number } | null = null;

  protected get questions(): string[] {
    return this.templateService.questions();
  }

  protected get templates(): TemplateRecord[] {
    return this.templateService.templates();
  }

  ngOnInit(): void {
    this.templateService.migrateFromLocal().subscribe();
  }

  protected async onFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    if (!input.files?.length) {
      return;
    }
    const file = input.files[0];
    this.selectedFileName = file.name;
    this.importError = '';
    this.isImporting = true;
    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data, { type: 'array' });
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const rows: unknown[][] = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1 });
      const normalized: string[] = rows.map((row: unknown[]) => String(row[0] ?? '').trim());
      const questions: string[] = normalized.filter((value: string, index: number) => {
        if (!value) {
          return false;
        }
        if (index === 0 && value.toLowerCase() === 'question') {
          return false;
        }
        return true;
      });
      this.templateService.setQuestions(questions);
      this.importSelectedQuestions = {};
      this.importSubsections = [];
      this.subsectionDraftName = '';
    } catch {
      this.importError = 'Unable to read the spreadsheet. Please upload a valid .xlsx file.';
    } finally {
      this.isImporting = false;
      input.value = '';
    }
  }

  protected clearQuestions(): void {
    this.templateService.clear();
  }

  protected openImportModal(): void {
    this.showImportModal = true;
  }

  protected closeImportModal(): void {
    this.showImportModal = false;
    this.createError = '';
    this.selectedFileName = '';
    this.subsectionDraftName = '';
    this.importSelectedQuestions = {};
    this.importSubsections = [];
  }

  protected updateNoteChars(value: string): void {
    this.noteChars = value.length;
  }


  protected createTemplate(): void {
    if (!this.questions.length) {
      this.createError = 'Import questions before creating a template.';
      return;
    }
    const now = new Date();
    const day = String(now.getDate()).padStart(2, '0');
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const year = now.getFullYear();
    const name = this.templateName.trim() || `Template ${day}-${month}-${year}`;
    this.templateService
      .createTemplateApi({
        name,
        note: this.importNote.trim(),
        tags: [],
        questions: this.questions,
        subsections: this.normalizeSubsections(this.importSubsections, this.questions.length),
      })
      .subscribe({
        next: () => {
          this.templateName = '';
          this.importNote = '';
          this.noteChars = 0;
          this.selectedFileName = '';
          this.createError = '';
          this.subsectionDraftName = '';
          this.importSelectedQuestions = {};
          this.importSubsections = [];
          this.showImportModal = false;
        },
      });
  }

  protected deleteTemplate(id: string): void {
    const confirmed = window.confirm('Delete this template?');
    if (!confirmed) {
      return;
    }
    this.templateService.deleteTemplateApi(id).subscribe();
  }

  protected toggleTemplate(id: string): void {
    if (this.editingTemplateId === id) {
      return;
    }
    this.expandedTemplateId = this.expandedTemplateId === id ? null : id;
  }

  protected startEdit(template: TemplateRecord): void {
    this.editingTemplateId = template.id;
    this.expandedTemplateId = template.id;
    this.editName = template.name;
    this.editQuestions = [...template.questions];
    this.editSubsections = this.normalizeSubsections(template.subsections ?? [], template.questions.length);
    this.editSubsectionDraftName = '';
    this.editSelectedQuestions = {};
    this.draggingEditQuestionIndex = null;
    this.draggingSubsectionId = null;
    this.draggingQuestion = null;
    this.editError = '';
  }

  protected cancelEdit(): void {
    this.editingTemplateId = null;
    this.editName = '';
    this.editQuestions = [];
    this.editSubsections = [];
    this.editSubsectionDraftName = '';
    this.editSelectedQuestions = {};
    this.draggingEditQuestionIndex = null;
    this.draggingSubsectionId = null;
    this.draggingQuestion = null;
    this.editError = '';
  }

  protected addQuestion(): void {
    this.editQuestions = [...this.editQuestions, ''];
  }

  protected removeQuestion(index: number): void {
    this.editQuestions = this.editQuestions.filter((_, i) => i !== index);
    this.editSubsections = this.normalizeSubsections(
      this.editSubsections.map((section) => ({
        ...section,
        questionIndices: section.questionIndices
          .filter((questionIndex) => questionIndex !== index)
          .map((questionIndex) => (questionIndex > index ? questionIndex - 1 : questionIndex)),
      })),
      this.editQuestions.length
    );
  }

  protected saveTemplate(template: TemplateRecord): void {
    const name = this.editName.trim();
    if (!name) {
      this.editError = 'Template name is required.';
      return;
    }
    const questions = this.editQuestions.map((q) => q.trim()).filter(Boolean);
    if (!questions.length) {
      this.editError = 'Add at least one question.';
      return;
    }
    this.templateService
      .updateTemplateApi(template.id, {
        name,
        note: template.note ?? null,
        tags: template.tags ?? [],
        questions,
        subsections: this.normalizeSubsections(this.editSubsections, questions.length),
      })
      .subscribe({
        next: () => {
          this.editingTemplateId = null;
          this.editName = '';
          this.editQuestions = [];
          this.editSubsections = [];
          this.editSubsectionDraftName = '';
          this.editSelectedQuestions = {};
          this.draggingEditQuestionIndex = null;
          this.draggingSubsectionId = null;
          this.draggingQuestion = null;
          this.editError = '';
        },
        error: () => {
          this.editError = 'Unable to save changes. Please try again.';
        },
      });
  }

  protected trackByTemplateId(_index: number, template: TemplateRecord): string {
    return template.id;
  }

  protected trackByIndex(index: number): number {
    return index;
  }

  protected toggleImportQuestionSelection(index: number, checked: boolean): void {
    if (checked && this.isImportQuestionAssigned(index)) {
      this.createError = 'This question already belongs to a subsection.';
      return;
    }
    this.importSelectedQuestions = {
      ...this.importSelectedQuestions,
      [index]: checked,
    };
  }

  protected addImportSubsectionFromSelection(): void {
    const name = this.subsectionDraftName.trim();
    if (!name) {
      this.createError = 'Enter subsection name.';
      return;
    }
    const selected = Object.entries(this.importSelectedQuestions)
      .filter(([, checked]) => checked)
      .map(([index]) => Number(index))
      .filter((index) => Number.isInteger(index))
      .filter((index) => !this.isImportQuestionAssigned(index))
      .sort((a, b) => a - b);
    if (!selected.length) {
      this.createError = 'Select at least one question for subsection.';
      return;
    }
    this.importSubsections = this.normalizeSubsections(
      [
        ...this.importSubsections,
        {
          id: crypto.randomUUID(),
          name,
          questionIndices: [...new Set(selected)],
        },
      ],
      this.questions.length
    );
    this.importSelectedQuestions = {};
    this.subsectionDraftName = '';
    this.createError = '';
  }

  protected removeImportSubsection(id: string): void {
    this.importSubsections = this.importSubsections.filter((section) => section.id !== id);
  }

  protected toggleEditQuestionSelection(index: number, checked: boolean): void {
    if (checked && this.isEditQuestionAssigned(index)) {
      this.editError = 'This question already belongs to a subsection.';
      return;
    }
    this.editSelectedQuestions = {
      ...this.editSelectedQuestions,
      [index]: checked,
    };
  }

  protected addEditSubsectionFromSelection(): void {
    const name = this.editSubsectionDraftName.trim();
    if (!name) {
      this.editError = 'Enter subsection name.';
      return;
    }
    const selected = Object.entries(this.editSelectedQuestions)
      .filter(([, checked]) => checked)
      .map(([index]) => Number(index))
      .filter((index) => Number.isInteger(index))
      .filter((index) => !this.isEditQuestionAssigned(index))
      .sort((a, b) => a - b);
    if (!selected.length) {
      this.editError = 'Select at least one question for subsection.';
      return;
    }
    this.editSubsections = this.normalizeSubsections(
      [
        ...this.editSubsections,
        { id: crypto.randomUUID(), name, questionIndices: [...new Set(selected)] },
      ],
      this.editQuestions.length
    );
    this.editSelectedQuestions = {};
    this.editSubsectionDraftName = '';
    this.editError = '';
  }

  protected removeEditSubsection(id: string): void {
    this.editSubsections = this.editSubsections.filter((section) => section.id !== id);
  }

  protected onEditQuestionDragStart(index: number): void {
    this.draggingEditQuestionIndex = index;
  }

  protected onEditQuestionDragOver(event: DragEvent): void {
    event.preventDefault();
  }

  protected onEditQuestionDrop(targetIndex: number): void {
    if (this.draggingEditQuestionIndex === null || this.draggingEditQuestionIndex === targetIndex) {
      return;
    }
    this.reorderEditQuestion(this.draggingEditQuestionIndex, targetIndex);
    this.draggingEditQuestionIndex = null;
  }

  protected onEditQuestionDragEnd(): void {
    this.draggingEditQuestionIndex = null;
  }

  protected moveSubsectionUp(id: string): void {
    const index = this.editSubsections.findIndex((section) => section.id === id);
    if (index <= 0) {
      return;
    }
    const next = [...this.editSubsections];
    const [section] = next.splice(index, 1);
    next.splice(index - 1, 0, section);
    this.editSubsections = next;
  }

  protected moveSubsectionDown(id: string): void {
    const index = this.editSubsections.findIndex((section) => section.id === id);
    if (index < 0 || index >= this.editSubsections.length - 1) {
      return;
    }
    const next = [...this.editSubsections];
    const [section] = next.splice(index, 1);
    next.splice(index + 1, 0, section);
    this.editSubsections = next;
  }

  protected subsectionQuestionIndexes(section: TemplateSubsection): number[] {
    return section.questionIndices;
  }

  protected subsectionQuestionLabel(index: number): string {
    return this.editQuestions[index] || `Question ${index + 1}`;
  }

  protected onSubsectionDragStart(sectionId: string): void {
    this.draggingSubsectionId = sectionId;
  }

  protected onSubsectionDragOver(event: DragEvent): void {
    event.preventDefault();
  }

  protected onSubsectionDrop(targetSectionId: string): void {
    if (!this.draggingSubsectionId || this.draggingSubsectionId === targetSectionId) {
      return;
    }
    const from = this.editSubsections.findIndex((section) => section.id === this.draggingSubsectionId);
    const to = this.editSubsections.findIndex((section) => section.id === targetSectionId);
    if (from < 0 || to < 0) {
      this.draggingSubsectionId = null;
      return;
    }
    const next = [...this.editSubsections];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    this.editSubsections = next;
    this.draggingSubsectionId = null;
  }

  protected onSubsectionDragEnd(): void {
    this.draggingSubsectionId = null;
  }

  protected onQuestionDragStart(sectionId: string, questionIndex: number): void {
    this.draggingQuestion = { sectionId, questionIndex };
  }

  protected onQuestionDragOver(event: DragEvent): void {
    event.preventDefault();
  }

  protected onQuestionDrop(targetSectionId: string, beforeQuestionIndex?: number): void {
    if (!this.draggingQuestion) {
      return;
    }
    const { sectionId: fromSectionId, questionIndex } = this.draggingQuestion;
    const source = this.editSubsections.find((section) => section.id === fromSectionId);
    const target = this.editSubsections.find((section) => section.id === targetSectionId);
    if (!source || !target) {
      this.draggingQuestion = null;
      return;
    }

    source.questionIndices = source.questionIndices.filter((index) => index !== questionIndex);
    target.questionIndices = target.questionIndices.filter((index) => index !== questionIndex);
    if (beforeQuestionIndex !== undefined) {
      const insertAt = target.questionIndices.findIndex((index) => index === beforeQuestionIndex);
      if (insertAt >= 0) {
        target.questionIndices.splice(insertAt, 0, questionIndex);
      } else {
        target.questionIndices.push(questionIndex);
      }
    } else {
      target.questionIndices.push(questionIndex);
    }

    this.editSubsections = this.normalizeSubsections(this.editSubsections, this.editQuestions.length);
    this.draggingQuestion = null;
  }

  protected onQuestionDragEnd(): void {
    this.draggingQuestion = null;
  }

  protected isImportQuestionAssigned(index: number): boolean {
    return this.importSubsections.some((section) => section.questionIndices.includes(index));
  }

  protected isEditQuestionAssigned(index: number): boolean {
    return this.editSubsections.some((section) => section.questionIndices.includes(index));
  }

  private normalizeSubsections(values: TemplateSubsection[], maxQuestions: number): TemplateSubsection[] {
    const normalized = values
      .map((value, index) => ({
        id: value.id || `subsection-${index + 1}`,
        name: value.name.trim(),
        questionIndices: [...new Set(value.questionIndices)]
          .map((item) => Number(item))
          .filter(
            (item) =>
              Number.isInteger(item) && item >= 0 && (maxQuestions <= 0 || item < maxQuestions)
          )
          .sort((a, b) => a - b),
      }))
      .filter((value) => value.name && value.questionIndices.length > 0)
      .map((value) => ({ ...value }));

    const seen = new Set<string>();
    const uniqueNames = normalized.filter((section) => {
      const key = section.name.toLowerCase();
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });

    const usedQuestions = new Set<number>();
    return uniqueNames
      .map((section) => ({
        ...section,
        questionIndices: section.questionIndices.filter((index) => {
          if (usedQuestions.has(index)) {
            return false;
          }
          usedQuestions.add(index);
          return true;
        }),
      }))
      .filter((section) => section.questionIndices.length > 0);
  }

  private reorderEditQuestion(fromIndex: number, toIndex: number): void {
    if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) {
      return;
    }
    const nextQuestions = [...this.editQuestions];
    const [movedQuestion] = nextQuestions.splice(fromIndex, 1);
    nextQuestions.splice(toIndex, 0, movedQuestion);
    this.editQuestions = nextQuestions;
    this.editSubsections = this.normalizeSubsections(
      this.editSubsections.map((section) => ({
        ...section,
        questionIndices: section.questionIndices.map((index) =>
          this.remapQuestionIndex(index, fromIndex, toIndex)
        ),
      })),
      this.editQuestions.length
    );
  }

  private remapQuestionIndex(index: number, fromIndex: number, toIndex: number): number {
    if (index === fromIndex) {
      return toIndex;
    }
    if (fromIndex < toIndex) {
      if (index > fromIndex && index <= toIndex) {
        return index - 1;
      }
      return index;
    }
    if (index >= toIndex && index < fromIndex) {
      return index + 1;
    }
    return index;
  }
}
