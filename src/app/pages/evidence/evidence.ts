import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { Location } from '@angular/common';

type EvidenceItem = {
  key: string;
  url: string;
  size: number;
  lastModified: string;
};

type EvidenceGroup = {
  asset: string;
  items: EvidenceItem[];
};

@Component({
  selector: 'app-evidence',
  imports: [CommonModule],
  templateUrl: './evidence.html',
  styleUrl: './evidence.scss',
})
export class Evidence implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);
  private readonly location = inject(Location);
  private readonly router = inject(Router);

  protected auditCode = '';
  protected folderUrl = '';
  protected groups: EvidenceGroup[] = [];
  protected loading = true;
  protected error = '';

  ngOnInit(): void {
    const code = this.route.snapshot.paramMap.get('code') ?? '';
    this.auditCode = code;
    if (!code) {
      this.loading = false;
      this.error = 'Missing audit code.';
      return;
    }
    this.http
      .get<{ folderUrl: string; items: EvidenceItem[] }>(
        `/api/evidence/list?audit_code=${encodeURIComponent(code)}`
      )
      .subscribe({
        next: (payload) => {
          this.folderUrl = payload.folderUrl;
          this.groups = this.groupByAsset(payload.items);
          this.loading = false;
        },
        error: () => {
          this.loading = false;
          this.error = 'Unable to load evidence.';
        },
      });
  }

  private groupByAsset(items: EvidenceItem[]): EvidenceGroup[] {
    const map = new Map<string, EvidenceItem[]>();
    items.forEach((item) => {
      const parts = item.key.split('/');
      const asset = parts.length > 1 ? parts[1] : 'Unassigned';
      const list = map.get(asset) ?? [];
      list.push(item);
      map.set(asset, list);
    });
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
      .map(([asset, list]) => ({
        asset,
        items: list.sort((a, b) => a.key.localeCompare(b.key)),
      }));
  }

  protected isImage(item: EvidenceItem): boolean {
    return /\.(png|jpe?g|gif|webp)$/i.test(item.key);
  }

  protected isVideo(item: EvidenceItem): boolean {
    return /\.(mp4|webm|mov)$/i.test(item.key);
  }

  protected getItemUrl(item: EvidenceItem): string {
    return item.url;
  }

  protected goBack(): void {
    this.router.navigate(['/audit-manage']).catch(() => this.location.back());
  }
}
