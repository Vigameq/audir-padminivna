import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { FormsModule, NgForm } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthState } from '../../auth-state';
import { DepartmentService } from '../../services/department.service';
import { RegionService } from '../../services/region.service';
import { ResponseDefinition, ResponseService } from '../../services/response.service';
import { SiteService } from '../../services/site.service';

@Component({
  selector: 'app-settings',
  imports: [CommonModule, FormsModule],
  templateUrl: './settings.html',
  styleUrl: './settings.scss',
})
export class Settings implements OnInit {
  private readonly auth = inject(AuthState);
  private readonly router = inject(Router);
  private readonly departmentService = inject(DepartmentService);
  private readonly siteService = inject(SiteService);
  private readonly regionService = inject(RegionService);
  private readonly responseService = inject(ResponseService);
  protected newDepartment = '';
  protected newSite = '';
  protected newRegion = '';
  protected showResponseModal = false;
  protected responseName = '';
  protected responseTypeInput = '';
  protected responseTypes: string[] = [];
  protected responseNegativeTypes: string[] = [];
  protected responseTypeNegative = false;
  protected get responses(): ResponseDefinition[] {
    return this.responseService.responses();
  }

  protected get departments(): string[] {
    return this.departmentService.departments();
  }

  protected get sites(): string[] {
    return this.siteService.sites();
  }

  protected get regions(): string[] {
    return this.regionService.regions();
  }


  protected addDepartment(form: NgForm): void {
    const value = this.newDepartment.trim();
    if (!value) {
      return;
    }
    this.departmentService.createDepartment(value).subscribe({
      next: () => {
        this.newDepartment = '';
        form.resetForm();
      },
    });
  }

  protected removeDepartment(name: string): void {
    this.departmentService.deleteDepartment(name).subscribe();
  }

  protected addSite(form: NgForm): void {
    const value = this.newSite.trim();
    if (!value) {
      return;
    }
    this.siteService.createSite(value).subscribe({
      next: () => {
        this.newSite = '';
        form.resetForm();
      },
    });
  }

  protected removeSite(name: string): void {
    this.siteService.deleteSite(name).subscribe();
  }

  protected addRegion(form: NgForm): void {
    const value = this.newRegion.trim();
    if (!value) {
      return;
    }
    this.regionService.createRegion(value).subscribe({
      next: () => {
        this.newRegion = '';
        form.resetForm();
      },
    });
  }

  protected removeRegion(name: string): void {
    this.regionService.deleteRegion(name).subscribe();
  }

  protected openResponseModal(): void {
    this.showResponseModal = true;
  }

  protected closeResponseModal(): void {
    this.showResponseModal = false;
    this.responseName = '';
    this.responseTypeInput = '';
    this.responseTypes = [];
    this.responseNegativeTypes = [];
    this.responseTypeNegative = false;
  }

  protected addResponse(): void {
    const name = this.responseName.trim();
    if (!name || !this.responseTypes.length) {
      return;
    }
    this.responseService
      .createResponse({
        name,
        types: [...this.responseTypes],
        negativeTypes: [...this.responseNegativeTypes],
      })
      .subscribe({
        next: () => this.closeResponseModal(),
      });
  }

  protected addResponseType(): void {
    const value = this.responseTypeInput.trim();
    if (!value) {
      return;
    }
    if (this.responseTypes.includes(value)) {
      this.responseTypeInput = '';
      return;
    }
    this.responseTypes = [...this.responseTypes, value];
    if (this.responseTypeNegative) {
      this.responseNegativeTypes = [...this.responseNegativeTypes, value];
      this.responseTypeNegative = false;
    }
    this.responseTypeInput = '';
  }

  protected removeResponseType(value: string): void {
    this.responseTypes = this.responseTypes.filter((item) => item !== value);
    this.responseNegativeTypes = this.responseNegativeTypes.filter((item) => item !== value);
  }

  public removeResponse(name: string): void {
    this.responseService.deleteResponseByName(name).subscribe();
  }

  protected isNegativeTag(response: ResponseDefinition, tag: string): boolean {
    return response.negativeTypes?.includes(tag);
  }

  protected isNegativeTagDraft(tag: string): boolean {
    return this.responseNegativeTypes.includes(tag);
  }

  ngOnInit(): void {
    if (this.auth.role() !== 'Super Admin') {
      this.router.navigate(['/dashboard']);
      return;
    }
    this.departmentService.migrateFromLocal().subscribe();
    this.siteService.migrateFromLocal().subscribe();
    this.regionService.migrateFromLocal().subscribe();
    this.responseService.migrateFromLocal().subscribe();
  }
}
