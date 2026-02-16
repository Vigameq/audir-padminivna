import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    redirectTo: 'login',
  },
  {
    path: 'login',
    loadComponent: () => import('./pages/login/login').then((m) => m.Login),
    title: 'Sign In',
  },
  {
    path: 'dashboard',
    loadComponent: () => import('./pages/dashboard/dashboard').then((m) => m.Dashboard),
    title: 'Dashboard',
  },
  {
    path: 'customer-dashboard',
    loadComponent: () =>
      import('./pages/customer-dashboard/customer-dashboard').then((m) => m.CustomerDashboard),
    title: 'Customer Dashboard',
  },
  {
    path: 'audit-plan',
    loadComponent: () =>
      import('./pages/audit-plan/audit-plan').then((m) => m.AuditPlan),
    title: 'Audit Plan',
  },
  {
    path: 'audit-manage',
    loadComponent: () =>
      import('./pages/audit-manage/audit-manage').then((m) => m.AuditManage),
    title: 'Audit Manage',
  },
  {
    path: 'nc-management',
    loadComponent: () =>
      import('./pages/nc-management/nc-management').then((m) => m.NcManagement),
    title: 'NC Management',
  },
  {
    path: 'reports',
    loadComponent: () => import('./pages/reports/reports').then((m) => m.Reports),
    title: 'Reports',
  },
  {
    path: 'user-management',
    loadComponent: () =>
      import('./pages/user-management/user-management').then((m) => m.UserManagement),
    title: 'User Management',
  },
  {
    path: 'settings',
    loadComponent: () => import('./pages/settings/settings').then((m) => m.Settings),
    title: 'Settings',
  },
  {
    path: 'audit-perform',
    loadComponent: () =>
      import('./pages/audit-perform/audit-perform').then((m) => m.AuditPerform),
    title: 'Audit Perform',
  },
  {
    path: 'audit-perform/:code',
    loadComponent: () =>
      import('./pages/audit-perform/audit-perform').then((m) => m.AuditPerform),
    title: 'Audit Perform',
  },
  {
    path: 'templates',
    loadComponent: () => import('./pages/templates/templates').then((m) => m.Templates),
    title: 'Templates',
  },
  {
    path: 'evidence/:code',
    loadComponent: () => import('./pages/evidence/evidence').then((m) => m.Evidence),
    title: 'Evidence',
  },
  {
    path: 'auditor',
    loadComponent: () => import('./pages/auditor/auditor').then((m) => m.Auditor),
    title: 'Auditor Workspace',
  },
  {
    path: 'manager',
    loadComponent: () => import('./pages/manager/manager').then((m) => m.Manager),
    title: 'Manager Workspace',
  },
  {
    path: 'super-admin',
    loadComponent: () =>
      import('./pages/super-admin/super-admin').then((m) => m.SuperAdmin),
    title: 'Super Admin Workspace',
  },
  {
    path: '**',
    redirectTo: '',
  },
];
