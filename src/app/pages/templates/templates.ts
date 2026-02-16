import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import * as XLSX from 'xlsx';
import { TemplateRecord, TemplateService } from '../../services/template.service';

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
  protected editError = '';

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
  }

  protected updateNoteChars(value: string): void {
    this.noteChars = value.length;
  }


  protected createTemplate(): void {
    if (!this.questions.length) {
      this.createError = 'Import questions before creating a template.';
      return;
    }
    const name = this.templateName.trim() || `Template ${new Date().toLocaleDateString()}`;
    this.templateService
      .createTemplateApi({
        name,
        note: this.importNote.trim(),
        tags: [],
        questions: this.questions,
      })
      .subscribe({
        next: () => {
          this.templateName = '';
          this.importNote = '';
          this.noteChars = 0;
          this.selectedFileName = '';
          this.createError = '';
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
    this.editError = '';
  }

  protected cancelEdit(): void {
    this.editingTemplateId = null;
    this.editName = '';
    this.editQuestions = [];
    this.editError = '';
  }

  protected addQuestion(): void {
    this.editQuestions = [...this.editQuestions, ''];
  }

  protected removeQuestion(index: number): void {
    this.editQuestions = this.editQuestions.filter((_, i) => i !== index);
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
      })
      .subscribe({
        next: () => {
          this.editingTemplateId = null;
          this.editName = '';
          this.editQuestions = [];
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
}
