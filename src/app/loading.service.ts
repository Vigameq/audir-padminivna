import { Injectable, computed, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class LoadingService {
  private readonly httpCount = signal(0);
  private readonly navigationActive = signal(false);

  readonly isLoading = computed(
    () => this.httpCount() > 0 || this.navigationActive()
  );

  show(): void {
    this.httpCount.update((count) => count + 1);
  }

  hide(): void {
    this.httpCount.update((count) => Math.max(0, count - 1));
  }

  setNavigation(active: boolean): void {
    this.navigationActive.set(active);
  }
}
