import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Observable, forkJoin, map, of, switchMap, tap } from 'rxjs';

const STORAGE_KEY = 'audir_regions';
const DEFAULT_REGIONS: string[] = [];

@Injectable({ providedIn: 'root' })
export class RegionService {
  private readonly http = inject(HttpClient);
  private readonly regionsSignal = signal<string[]>(this.loadRegions());
  private readonly baseUrl = '/api';

  readonly regions = this.regionsSignal.asReadonly();

  addRegion(name: string): void {
    const value = name.trim();
    if (!value) {
      return;
    }
    const current = this.regionsSignal();
    if (this.hasName(current, value)) {
      return;
    }
    const next = this.uniqueNames([value, ...current]);
    this.regionsSignal.set(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }

  removeRegion(name: string): void {
    const next = this.regionsSignal().filter((region) => region !== name);
    this.regionsSignal.set(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }

  private loadRegions(): string[] {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      return [...DEFAULT_REGIONS];
    }
    try {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed) && parsed.every((item) => typeof item === 'string')) {
        return this.uniqueNames(parsed);
      }
    } catch {
      return [...DEFAULT_REGIONS];
    }
    return [...DEFAULT_REGIONS];
  }

  syncFromApi(): Observable<string[]> {
    return this.http.get<unknown[]>(`${this.baseUrl}/regions`).pipe(
      map((rows) =>
        Array.isArray(rows)
          ? rows.map((row) => String((row as { name?: string })?.name ?? '')).filter(Boolean)
          : []
      ),
      map((regions) => this.uniqueNames(regions)),
      tap((regions) => {
        this.regionsSignal.set(regions);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(regions));
      })
    );
  }

  createRegion(name: string): Observable<string[]> {
    return this.http.post(`${this.baseUrl}/regions`, { name }).pipe(
      switchMap(() => this.syncFromApi())
    );
  }

  deleteRegion(name: string): Observable<string[]> {
    return this.http.delete(`${this.baseUrl}/regions/${encodeURIComponent(name)}`).pipe(
      switchMap(() => this.syncFromApi())
    );
  }

  migrateFromLocal(): Observable<string[]> {
    const local = this.uniqueNames(this.loadLocalRaw());
    return this.http.get<unknown[]>(`${this.baseUrl}/regions`).pipe(
      map((rows) =>
        Array.isArray(rows)
          ? rows.map((row) => String((row as { name?: string })?.name ?? '')).filter(Boolean)
          : []
      ),
      map((remote) => this.uniqueNames(remote)),
      switchMap((remote) => {
        if (remote.length) {
          this.regionsSignal.set(remote);
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
          toCreate.map((name) => this.http.post(`${this.baseUrl}/regions`, { name }))
        ).pipe(switchMap(() => this.syncFromApi()));
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
