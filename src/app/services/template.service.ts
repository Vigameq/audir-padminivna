import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Observable, forkJoin, map, of, switchMap, tap } from 'rxjs';

const STORAGE_KEY = 'audir_template_questions';
const TEMPLATE_KEY = 'audir_templates';

export type TemplateRecord = {
  id: string;
  name: string;
  note: string;
  tags: string[];
  questions: string[];
  createdAt: string;
};

@Injectable({ providedIn: 'root' })
export class TemplateService {
  private readonly http = inject(HttpClient);
  private readonly questionsSignal = signal<string[]>(this.loadQuestions());
  private readonly templatesSignal = signal<TemplateRecord[]>(this.loadTemplates());
  private readonly baseUrl = '/api';

  readonly questions = this.questionsSignal.asReadonly();
  readonly templates = this.templatesSignal.asReadonly();

  setQuestions(questions: string[]): void {
    const cleaned = questions.filter((q) => q.trim().length > 0);
    this.questionsSignal.set(cleaned);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cleaned));
  }

  clear(): void {
    this.questionsSignal.set([]);
    localStorage.removeItem(STORAGE_KEY);
  }

  createTemplate(payload: Omit<TemplateRecord, 'id' | 'createdAt'>): void {
    const next = [
      {
        ...payload,
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
      },
      ...this.templatesSignal(),
    ];
    this.templatesSignal.set(next);
    localStorage.setItem(TEMPLATE_KEY, JSON.stringify(next));
  }

  deleteTemplate(id: string): void {
    const next = this.templatesSignal().filter((item) => item.id !== id);
    this.templatesSignal.set(next);
    localStorage.setItem(TEMPLATE_KEY, JSON.stringify(next));
  }

  syncFromApi(): Observable<TemplateRecord[]> {
    return this.http.get<unknown[]>(`${this.baseUrl}/templates`).pipe(
      map((rows) => (Array.isArray(rows) ? rows.map((row) => this.mapFromApi(row)) : [])),
      map((templates) => this.uniqueByName(templates)),
      tap((templates) => {
        this.templatesSignal.set(templates);
        localStorage.setItem(TEMPLATE_KEY, JSON.stringify(templates));
      })
    );
  }

  createTemplateApi(payload: Omit<TemplateRecord, 'id' | 'createdAt'>): Observable<TemplateRecord[]> {
    return this.http
      .post(`${this.baseUrl}/templates`, {
        name: payload.name,
        note: payload.note ?? null,
        tags: payload.tags ?? [],
        questions: payload.questions ?? [],
      })
      .pipe(switchMap(() => this.syncFromApi()));
  }

  deleteTemplateApi(id: string): Observable<TemplateRecord[]> {
    return this.http.delete(`${this.baseUrl}/templates/${id}`).pipe(
      switchMap(() => this.syncFromApi())
    );
  }

  updateTemplateApi(
    id: string,
    payload: Omit<TemplateRecord, 'id' | 'createdAt'>
  ): Observable<TemplateRecord[]> {
    return this.http
      .put(`${this.baseUrl}/templates/${id}`, {
        name: payload.name,
        note: payload.note ?? null,
        tags: payload.tags ?? [],
        questions: payload.questions ?? [],
      })
      .pipe(switchMap(() => this.syncFromApi()));
  }

  migrateFromLocal(): Observable<TemplateRecord[]> {
    const local = this.uniqueByName(this.loadLocalRaw());
    return this.http.get<unknown[]>(`${this.baseUrl}/templates`).pipe(
      map((rows) => (Array.isArray(rows) ? rows.map((row) => this.mapFromApi(row)) : [])),
      map((remote) => this.uniqueByName(remote)),
      switchMap((remote) => {
        if (remote.length) {
          this.templatesSignal.set(remote);
          localStorage.setItem(TEMPLATE_KEY, JSON.stringify(remote));
          return of(remote);
        }
        if (!local.length) {
          return of(remote);
        }
        const toCreate = local.filter((item) => !this.hasName(remote, item.name));
        if (!toCreate.length) {
          return this.syncFromApi();
        }
        return forkJoin(
          toCreate.map((template) =>
            this.http.post(`${this.baseUrl}/templates`, {
              name: template.name,
              note: template.note ?? null,
              tags: template.tags ?? [],
              questions: template.questions ?? [],
            })
          )
        ).pipe(switchMap(() => this.syncFromApi()));
      })
    );
  }

  private loadQuestions(): string[] {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      return [];
    }
    try {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed) && parsed.every((item) => typeof item === 'string')) {
        return parsed;
      }
    } catch {
      return [];
    }
    return [];
  }

  private loadTemplates(): TemplateRecord[] {
    const stored = localStorage.getItem(TEMPLATE_KEY);
    if (!stored) {
      return [];
    }
    try {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) {
        return this.uniqueByName(parsed as TemplateRecord[]);
      }
    } catch {
      return [];
    }
    return [];
  }

  private loadLocalRaw(): TemplateRecord[] {
    const stored = localStorage.getItem(TEMPLATE_KEY);
    if (!stored) {
      return [];
    }
    try {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) {
        return this.uniqueByName(parsed as TemplateRecord[]);
      }
    } catch {
      return [];
    }
    return [];
  }

  private mapFromApi(payload: any): TemplateRecord {
    return {
      id: String(payload?.id ?? ''),
      name: String(payload?.name ?? ''),
      note: String(payload?.note ?? ''),
      tags: Array.isArray(payload?.tags) ? payload.tags : [],
      questions: Array.isArray(payload?.questions) ? payload.questions : [],
      createdAt: String(payload?.created_at ?? ''),
    };
  }

  private uniqueByName(values: TemplateRecord[]): TemplateRecord[] {
    const seen = new Set<string>();
    const result: TemplateRecord[] = [];
    values.forEach((value) => {
      const normalized = value.name.trim();
      if (!normalized) {
        return;
      }
      const key = normalized.toLowerCase();
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      result.push({ ...value, name: normalized });
    });
    return result;
  }

  private hasName(values: TemplateRecord[], candidate: string): boolean {
    const key = candidate.trim().toLowerCase();
    return values.some((value) => value.name.trim().toLowerCase() === key);
  }
}
