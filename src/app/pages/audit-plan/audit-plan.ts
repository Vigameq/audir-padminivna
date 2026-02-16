import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { FormsModule, NgForm } from '@angular/forms';
import { AuditPlanService } from '../../services/audit-plan.service';
import { DepartmentService } from '../../services/department.service';
import { RegionService } from '../../services/region.service';
import { ResponseService } from '../../services/response.service';
import { SiteService } from '../../services/site.service';
import { TemplateService } from '../../services/template.service';
import { User, UserService } from '../../services/user.service';

@Component({
  selector: 'app-audit-plan',
  imports: [CommonModule, FormsModule],
  templateUrl: './audit-plan.html',
  styleUrl: './audit-plan.scss',
})
export class AuditPlan implements OnInit {
  private readonly auditPlanService = inject(AuditPlanService);
  private readonly userService = inject(UserService);
  private readonly departmentService = inject(DepartmentService);
  private readonly siteService = inject(SiteService);
  private readonly regionService = inject(RegionService);
  private readonly templateService = inject(TemplateService);
  private readonly responseService = inject(ResponseService);

  protected noteChars = 0;
  protected readonly today = new Date().toISOString().split('T')[0];
  protected auditForm = {
    startDate: '',
    endDate: '',
    auditType: '',
    auditSubtype: '',
    auditorName: '',
    department: '',
    locationCity: '',
    site: '',
    country: '',
    region: '',
    auditNote: '',
    responseType: '',
    assetScopeCount: 1,
    customerId: '',
  };
  protected readonly assetScopeOptions = Array.from({ length: 150 }, (_, index) => index + 1);
  protected auditors: User[] = [];
  protected customers: User[] = [];
  protected showSuccessModal = false;
  protected successSummary = {
    dateRange: '',
    auditType: '',
    auditSubtype: '',
  };

  protected readonly auditTypes = [
    'Process Audit',
    'Product Audit',
    'System Audit',
    'Supplier Audit',
  ];

  protected get auditSubtypes(): string[] {
    return this.templateService.templates().map((template) => template.name);
  }

  protected readonly citiesByCountry: Record<string, string[]> = {
    India: [
      'Agartala',
      'Agra',
      'Ahmedabad',
      'Ajmer',
      'Aligarh',
      'Allahabad',
      'Amritsar',
      'Aurangabad',
      'Bengaluru',
      'Bhopal',
      'Bhubaneswar',
      'Chandigarh',
      'Chennai',
      'Coimbatore',
      'Cuttack',
      'Dehradun',
      'Delhi',
      'Dhanbad',
      'Faridabad',
      'Gaya',
      'Ghaziabad',
      'Gurugram',
      'Guwahati',
      'Gwalior',
      'Hyderabad',
      'Indore',
      'Jaipur',
      'Jabalpur',
      'Jamshedpur',
      'Jodhpur',
      'Kanpur',
      'Kochi',
      'Kolkata',
      'Kota',
      'Kozhikode',
      'Lucknow',
      'Ludhiana',
      'Madurai',
      'Mangaluru',
      'Meerut',
      'Mumbai',
      'Mysuru',
      'Nagpur',
      'Nashik',
      'Noida',
      'Panaji',
      'Patna',
      'Pimpri-Chinchwad',
      'Pune',
      'Raipur',
      'Rajkot',
      'Ranchi',
      'Surat',
      'Thane',
      'Thiruvananthapuram',
      'Tiruchirappalli',
      'Udaipur',
      'Vadodara',
      'Varanasi',
      'Vijayawada',
      'Visakhapatnam',
    ],
    USA: [
      'Atlanta',
      'Austin',
      'Baltimore',
      'Boston',
      'Charlotte',
      'Chicago',
      'Columbus',
      'Dallas',
      'Denver',
      'Detroit',
      'Houston',
      'Indianapolis',
      'Jacksonville',
      'Kansas City',
      'Las Vegas',
      'Los Angeles',
      'Miami',
      'Minneapolis',
      'Nashville',
      'New York',
      'Orlando',
      'Philadelphia',
      'Phoenix',
      'Pittsburgh',
      'Portland',
      'Raleigh',
      'San Antonio',
      'San Diego',
      'San Francisco',
      'San Jose',
      'Seattle',
      'Tampa',
      'Washington, DC',
    ],
    Canada: [
      'Calgary',
      'Edmonton',
      'Halifax',
      'Hamilton',
      'Kitchener',
      'London',
      'Montreal',
      'Ottawa',
      'Quebec City',
      'Regina',
      'Saskatoon',
      'St. John\'s',
      'Toronto',
      'Vancouver',
      'Victoria',
      'Winnipeg',
    ],
  };

  protected get cities(): string[] {
    return this.citiesByCountry[this.auditForm.country] ?? [];
  }

  protected updateNoteChars(value: string): void {
    this.noteChars = value.length;
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

  protected get responses(): string[] {
    return this.responseService.responses().map((response) => response.name);
  }

  protected onAuditorChange(value: string): void {
    this.auditForm.auditorName = value;
    if (!value) {
      return;
    }
    const match = this.auditors.find(
      (auditor) => `${auditor.first_name ?? ''} ${auditor.last_name ?? ''}`.trim() === value
    );
    this.auditForm.department = match?.department ?? '';
  }

  ngOnInit(): void {
    this.auditPlanService.migrateFromLocal().subscribe();
    this.departmentService.migrateFromLocal().subscribe();
    this.siteService.migrateFromLocal().subscribe();
    this.regionService.migrateFromLocal().subscribe();
    this.templateService.migrateFromLocal().subscribe();
    this.responseService.migrateFromLocal().subscribe();
    this.userService.listUsers().subscribe({
      next: (users) => {
        this.auditors = users.filter((user) => user.role === 'Auditor');
        this.customers = users.filter((user) => user.role === 'Customer');
      },
    });
  }

  protected cancel(form: NgForm): void {
    this.auditForm = {
      startDate: '',
      endDate: '',
      auditType: '',
      auditSubtype: '',
      auditorName: '',
      department: '',
      locationCity: '',
      site: '',
      country: '',
      region: '',
      auditNote: '',
      responseType: '',
      assetScopeCount: 1,
      customerId: '',
    };
    this.noteChars = 0;
    form.resetForm(this.auditForm);
  }

  protected createAudit(form: NgForm): void {
    if (form.invalid) {
      return;
    }
    this.successSummary = {
      dateRange: `${this.auditForm.startDate} → ${this.auditForm.endDate}`,
      auditType: this.auditForm.auditType,
      auditSubtype: this.auditForm.auditSubtype || '—',
    };
    this.auditPlanService
      .createPlan({
        startDate: this.auditForm.startDate,
        endDate: this.auditForm.endDate,
        auditType: this.auditForm.auditType,
        auditSubtype: this.auditForm.auditSubtype,
        auditorName: this.auditForm.auditorName,
        department: this.auditForm.department,
        locationCity: this.auditForm.locationCity,
        site: this.auditForm.site,
        country: this.auditForm.country,
        region: this.auditForm.region,
        auditNote: this.auditForm.auditNote,
        responseType: this.auditForm.responseType,
        customerId: this.auditForm.customerId || undefined,
        assetScope: Array.from(
          { length: this.auditForm.assetScopeCount || 1 },
          (_, index) => index + 1
        ),
      })
      .subscribe({
        next: () => {
          this.cancel(form);
          this.showSuccessModal = true;
        },
      });
  }

  protected closeSuccessModal(): void {
    this.showSuccessModal = false;
  }
}
