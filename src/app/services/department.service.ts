import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Observable, forkJoin, map, of, switchMap, tap } from 'rxjs';

const STORAGE_KEY = 'audir_departments';
const DEFAULT_DEPARTMENTS: string[] = [];

@Injectable({ providedIn: 'root' })
export class DepartmentService {
  private readonly http = inject(HttpClient);
  private readonly departmentsSignal = signal<string[]>(this.loadDepartments());
  private readonly baseUrl = '/api';

  readonly departments = this.departmentsSignal.asReadonly();

  addDepartment(name: string): void {
    const value = name.trim();
    if (!value) {
      return;
    }
    const current = this.departmentsSignal();
    if (this.hasName(current, value)) {
      return;
    }
    const next = this.uniqueNames([value, ...current]);
    this.departmentsSignal.set(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }

  removeDepartment(name: string): void {
    const next = this.departmentsSignal().filter((dept) => dept !== name);
    this.departmentsSignal.set(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }

  syncFromApi(): Observable<string[]> {
    return this.http.get<unknown[]>(`${this.baseUrl}/departments`).pipe(
      map((rows) =>
        Array.isArray(rows)
          ? rows
              .map((row) => String((row as { name?: string })?.name ?? ''))
              .filter(Boolean)
          : []
      ),
      map((departments) => this.uniqueNames(departments)),
      tap((departments) => {
        this.departmentsSignal.set(departments);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(departments));
      })
    );
  }

  createDepartment(name: string): Observable<string[]> {
    return this.http.post(`${this.baseUrl}/departments`, { name }).pipe(
      switchMap(() => this.syncFromApi())
    );
  }

  deleteDepartment(name: string): Observable<string[]> {
    return this.http.delete(`${this.baseUrl}/departments/${encodeURIComponent(name)}`).pipe(
      switchMap(() => this.syncFromApi())
    );
  }

  migrateFromLocal(): Observable<string[]> {
    const local = this.uniqueNames(this.loadLocalRaw());
    return this.http.get<unknown[]>(`${this.baseUrl}/departments`).pipe(
      map((rows) =>
        Array.isArray(rows)
          ? rows.map((row) => String((row as { name?: string })?.name ?? '')).filter(Boolean)
          : []
      ),
      map((remote) => this.uniqueNames(remote)),
      switchMap((remote) => {
        if (remote.length) {
          this.departmentsSignal.set(remote);
          localStorage.setItem(STORAGE_KEY, JSON.stringify(remote));
          return of(remote);
        }
        if (!local.length) {
          return of(remote);
        }
        const toCreate = local.filter((item) => !this.hasName(remote, item));
        if (!toCreate.length) {
          return this.syncFromApi();
        }
        return forkJoin(
          toCreate.map((name) => this.http.post(`${this.baseUrl}/departments`, { name }))
        ).pipe(switchMap(() => this.syncFromApi()));
      })
    );
  }

  private loadDepartments(): string[] {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      return [...DEFAULT_DEPARTMENTS];
    }
    try {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed) && parsed.every((item) => typeof item === 'string')) {
        return this.uniqueNames(parsed);
      }
    } catch {
      return [...DEFAULT_DEPARTMENTS];
    }
    return [...DEFAULT_DEPARTMENTS];
  }

  private loadLocalRaw(): string[] {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      return [];
    }
    try {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed) && parsed.every((item) => typeof item === 'string')) {
        return this.uniqueNames(parsed);
      }
    } catch {
      return [];
    }
    return [];
  }

  private uniqueNames(values: string[]): string[] {
    const seen = new Set<string>();
    const result: string[] = [];
    values.forEach((value) => {
      const normalized = value.trim();
      if (!normalized) {
        return;
      }
      const key = normalized.toLowerCase();
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      result.push(normalized);
    });
    return result;
  }

  private hasName(values: string[], candidate: string): boolean {
    const key = candidate.trim().toLowerCase();
    return values.some((value) => value.trim().toLowerCase() === key);
  }
}
