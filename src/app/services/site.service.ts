import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Observable, forkJoin, map, of, switchMap, tap } from 'rxjs';

const STORAGE_KEY = 'audir_sites';
const DEFAULT_SITES: string[] = [];

@Injectable({ providedIn: 'root' })
export class SiteService {
  private readonly http = inject(HttpClient);
  private readonly sitesSignal = signal<string[]>(this.loadSites());
  private readonly baseUrl = '/api';

  readonly sites = this.sitesSignal.asReadonly();

  addSite(name: string): void {
    const value = name.trim();
    if (!value) {
      return;
    }
    const current = this.sitesSignal();
    if (this.hasName(current, value)) {
      return;
    }
    const next = this.uniqueNames([value, ...current]);
    this.sitesSignal.set(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }

  removeSite(name: string): void {
    const next = this.sitesSignal().filter((site) => site !== name);
    this.sitesSignal.set(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }

  private loadSites(): string[] {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      return [...DEFAULT_SITES];
    }
    try {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed) && parsed.every((item) => typeof item === 'string')) {
        return this.uniqueNames(parsed);
      }
    } catch {
      return [...DEFAULT_SITES];
    }
    return [...DEFAULT_SITES];
  }

  syncFromApi(): Observable<string[]> {
    return this.http.get<unknown[]>(`${this.baseUrl}/sites`).pipe(
      map((rows) =>
        Array.isArray(rows)
          ? rows.map((row) => String((row as { name?: string })?.name ?? '')).filter(Boolean)
          : []
      ),
      map((sites) => this.uniqueNames(sites)),
      tap((sites) => {
        this.sitesSignal.set(sites);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(sites));
      })
    );
  }

  createSite(name: string): Observable<string[]> {
    return this.http.post(`${this.baseUrl}/sites`, { name }).pipe(
      switchMap(() => this.syncFromApi())
    );
  }

  deleteSite(name: string): Observable<string[]> {
    return this.http.delete(`${this.baseUrl}/sites/${encodeURIComponent(name)}`).pipe(
      switchMap(() => this.syncFromApi())
    );
  }

  migrateFromLocal(): Observable<string[]> {
    const local = this.uniqueNames(this.loadLocalRaw());
    return this.http.get<unknown[]>(`${this.baseUrl}/sites`).pipe(
      map((rows) =>
        Array.isArray(rows)
          ? rows.map((row) => String((row as { name?: string })?.name ?? '')).filter(Boolean)
          : []
      ),
      map((remote) => this.uniqueNames(remote)),
      switchMap((remote) => {
        if (remote.length) {
          this.sitesSignal.set(remote);
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
        return forkJoin(toCreate.map((name) => this.http.post(`${this.baseUrl}/sites`, { name }))).pipe(
          switchMap(() => this.syncFromApi())
        );
      })
    );
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
