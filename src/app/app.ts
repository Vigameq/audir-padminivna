import { CommonModule } from '@angular/common';
import { Component, effect, inject, ElementRef, HostListener, ViewChild } from '@angular/core';
import {
  NavigationCancel,
  NavigationEnd,
  NavigationError,
  NavigationStart,
  Router,
  RouterLink,
  RouterLinkActive,
  RouterOutlet,
} from '@angular/router';
import { AuthState } from './auth-state';
import { DataSyncService } from './services/data-sync.service';
import { LoadingService } from './loading.service';
import { AuditPlanRecord, AuditPlanService } from './services/audit-plan.service';
import { NcRecord, NcService } from './services/nc.service';
import { UserService } from './services/user.service';

@Component({
  selector: 'app-root',
  imports: [CommonModule, RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App {
  protected readonly auth = inject(AuthState);
  protected readonly loading = inject(LoadingService);
  private readonly router = inject(Router);
  private readonly dataSync = inject(DataSyncService);
  private readonly userService = inject(UserService);
  private readonly auditPlanService = inject(AuditPlanService);
  private readonly ncService = inject(NcService);
  protected isUserMenuOpen = false;
  protected isNotificationOpen = false;
  @ViewChild('userMenu') private userMenuRef?: ElementRef<HTMLElement>;
  @ViewChild('notifyMenu') private notifyMenuRef?: ElementRef<HTMLElement>;

  constructor() {
    effect(() => {
      if (this.auth.isLoggedIn()) {
        this.auditPlanService.clearCache();
        this.dataSync.syncAll().subscribe();
        this.loadUserDepartment();
        this.ncService.listRecords().subscribe();
      } else {
        this.isUserMenuOpen = false;
        this.isNotificationOpen = false;
      }
    });
    this.router.events.subscribe((event) => {
      if (event instanceof NavigationStart) {
        this.loading.setNavigation(true);
      } else if (
        event instanceof NavigationEnd ||
        event instanceof NavigationCancel ||
        event instanceof NavigationError
      ) {
        this.loading.setNavigation(false);
      }
    });
  }

  private loadUserDepartment(): void {
    const email = this.auth.email();
    if (!email) {
      return;
    }
    this.userService.listUsers().subscribe({
      next: (users) => {
        const match = users.find((user) => user.email === email);
        if (match?.first_name) {
          this.auth.setFirstName(match.first_name);
        }
        if (match?.last_name) {
          this.auth.setLastName(match.last_name);
        }
        if (match?.department) {
          this.auth.setDepartment(match.department);
        }
      },
    });
  }

  protected get showNav(): boolean {
    return !this.router.url.startsWith('/login');
  }

  protected logout(): void {
    this.auth.logout();
    this.router.navigate(['/login']);
    this.isUserMenuOpen = false;
    this.isNotificationOpen = false;
  }

  protected get displayName(): string {
    const firstName = this.auth.firstName();
    if (firstName) {
      return firstName;
    }
    return 'User';
  }

  protected get fullName(): string {
    const first = this.auth.firstName();
    const last = this.auth.lastName();
    const combined = `${first} ${last}`.trim();
    return combined || this.displayName;
  }

  protected get avatarText(): string {
    const source = this.auth.email() || this.auth.role() || 'U';
    const cleaned = source.split('@')[0].replace(/[^a-zA-Z0-9]/g, '');
    if (!cleaned) {
      return 'U';
    }
    return cleaned.slice(0, 2).toUpperCase();
  }

  protected toggleUserMenu(): void {
    this.isNotificationOpen = false;
    this.isUserMenuOpen = !this.isUserMenuOpen;
  }

  protected closeUserMenu(): void {
    this.isUserMenuOpen = false;
  }

  protected toggleNotifications(): void {
    this.isUserMenuOpen = false;
    this.isNotificationOpen = !this.isNotificationOpen;
  }

  protected closeNotifications(): void {
    this.isNotificationOpen = false;
  }

  @HostListener('document:click', ['$event'])
  protected handleDocumentClick(event: MouseEvent): void {
    const target = event.target as Node | null;
    if (this.isUserMenuOpen && this.userMenuRef?.nativeElement) {
      const inside = this.userMenuRef.nativeElement.contains(target);
      if (!inside) {
        this.isUserMenuOpen = false;
      }
    }
    if (this.isNotificationOpen && this.notifyMenuRef?.nativeElement) {
      const inside = this.notifyMenuRef.nativeElement.contains(target);
      if (!inside) {
        this.isNotificationOpen = false;
      }
    }
  }

  protected get notificationCount(): number {
    const readMap = this.getReadMap();
    return this.notifications.filter((item) => !readMap[item.id]).length;
  }

  protected get notifications(): NotificationItem[] {
    if (!this.auth.isLoggedIn()) {
      return [];
    }
    const role = this.auth.role();
    const audits = this.auditPlanService.plans();
    const records = this.ncService.records();
    const items: NotificationItem[] = [];

    if (role === 'Auditor') {
      audits
        .filter((audit) => this.isAssignedToCurrentUser(audit))
        .forEach((audit) => {
          items.push({
            id: `audit-assigned-${audit.code}`,
            title: 'Audit assigned',
            detail: this.formatAuditLabel(audit.auditType, audit.auditSubtype, audit.code),
            route: ['/audit-perform', audit.code],
          });
        });
      records
        .filter(
          (record) =>
            this.isPendingReview(record) && this.isAuditOwnedByCurrentAuditor(record)
        )
        .forEach((record) => {
          items.push({
            id: `nc-review-${record.answerId}`,
            title: 'NC pending review',
            detail: this.formatAuditLabel(record.auditType, record.auditSubtype, record.auditCode),
            route: ['/nc-management'],
            queryParams: { tab: 'pending', answerId: record.answerId, audit: record.auditCode },
          });
        });
      return items;
    }

    if (role === 'Manager' || role === 'Super Admin') {
      records.filter((record) => this.isPendingReview(record)).forEach((record) => {
        items.push({
          id: `nc-review-${record.answerId}`,
          title: 'NC pending review',
          detail: this.formatAuditLabel(record.auditType, record.auditSubtype, record.auditCode),
          route: ['/nc-management'],
          queryParams: { tab: 'pending', answerId: record.answerId, audit: record.auditCode },
        });
      });
      return items;
    }

    const department = this.auth.department().trim().toLowerCase();
    if (!department) {
      return [];
    }
    records
      .filter((record) => this.isAssignedNc(record, department))
      .forEach((record) => {
        items.push({
          id: `nc-assigned-${record.answerId}`,
          title: 'NC assigned',
          detail: this.formatAuditLabel(record.auditType, record.auditSubtype, record.auditCode),
          route: ['/nc-management'],
          queryParams: { tab: 'flagged', answerId: record.answerId, audit: record.auditCode },
        });
      });
    return items;
  }

  protected openNotification(item: NotificationItem): void {
    this.isNotificationOpen = false;
    this.markNotificationRead(item.id);
    this.router.navigate(item.route, { queryParams: item.queryParams });
  }

  private isAssignedToCurrentUser(audit: AuditPlanRecord): boolean {
    const first = this.auth.firstName().trim();
    const last = this.auth.lastName().trim();
    const fullName = `${first} ${last}`.trim().toLowerCase();
    if (!fullName) {
      return false;
    }
    return audit.auditorName.trim().toLowerCase() === fullName;
  }

  private isAuditOwnedByCurrentAuditor(record: NcRecord): boolean {
    const first = this.auth.firstName().trim();
    const last = this.auth.lastName().trim();
    const fullName = `${first} ${last}`.trim().toLowerCase();
    if (!fullName) {
      return false;
    }
    return record.auditorName.trim().toLowerCase() === fullName;
  }

  private isPendingReview(record: NcRecord): boolean {
    return (record.status || '').trim().toLowerCase() === 'resolution submitted';
  }

  private isAssignedNc(record: NcRecord, department: string): boolean {
    const status = (record.status || 'Assigned').trim().toLowerCase();
    const allowed = status === 'assigned' || status === 'rework' || status === 'in progress';
    if (!allowed) {
      return false;
    }
    return record.assignedNc?.trim().toLowerCase() === department;
  }

  private formatAuditLabel(auditType: string, auditSubtype: string, code: string): string {
    const base = [auditType, auditSubtype].filter(Boolean).join(' · ');
    const suffix = code ? ` • ${code}` : '';
    return `${base || 'Audit'}${suffix}`;
  }

  private getReadKey(): string {
    const email = this.auth.email() || 'guest';
    return `audir_notification_reads_${email}`;
  }

  private getReadMap(): Record<string, number> {
    if (!this.auth.isLoggedIn()) {
      return {};
    }
    const stored = localStorage.getItem(this.getReadKey());
    if (!stored) {
      return {};
    }
    try {
      const parsed = JSON.parse(stored);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  private markNotificationRead(id: string): void {
    const map = this.getReadMap();
    map[id] = Date.now();
    localStorage.setItem(this.getReadKey(), JSON.stringify(map));
  }
}

type NotificationItem = {
  id: string;
  title: string;
  detail: string;
  route: string[];
  queryParams?: Record<string, string | number | boolean>;
};
