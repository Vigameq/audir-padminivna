import { Injectable, signal } from '@angular/core';

const AUTH_KEY = 'audir_logged_in';
const TOKEN_KEY = 'audir_access_token';
const ROLE_KEY = 'audir_role';
const EMAIL_KEY = 'audir_email';
const DEPARTMENT_KEY = 'audir_department';
const FIRST_NAME_KEY = 'audir_first_name';
const LAST_NAME_KEY = 'audir_last_name';

@Injectable({ providedIn: 'root' })
export class AuthState {
  private readonly loggedInSignal = signal(this.loadInitialState());
  private readonly tokenSignal = signal(this.loadToken());
  private readonly roleSignal = signal(this.loadRole());
  private readonly emailSignal = signal(this.loadEmail());
  private readonly departmentSignal = signal(this.loadDepartment());
  private readonly firstNameSignal = signal(this.loadFirstName());
  private readonly lastNameSignal = signal(this.loadLastName());

  readonly isLoggedIn = this.loggedInSignal.asReadonly();
  readonly accessToken = this.tokenSignal.asReadonly();
  readonly role = this.roleSignal.asReadonly();
  readonly email = this.emailSignal.asReadonly();
  readonly department = this.departmentSignal.asReadonly();
  readonly firstName = this.firstNameSignal.asReadonly();
  readonly lastName = this.lastNameSignal.asReadonly();

  login(token: string, role?: string, email?: string): void {
    this.loggedInSignal.set(true);
    localStorage.setItem(AUTH_KEY, 'true');
    this.tokenSignal.set(token);
    localStorage.setItem(TOKEN_KEY, token);
    if (role) {
      this.roleSignal.set(role);
      localStorage.setItem(ROLE_KEY, role);
    }
    if (email) {
      this.emailSignal.set(email);
      localStorage.setItem(EMAIL_KEY, email);
    }
  }

  setDepartment(department: string): void {
    this.departmentSignal.set(department);
    localStorage.setItem(DEPARTMENT_KEY, department);
  }

  setFirstName(firstName: string): void {
    this.firstNameSignal.set(firstName);
    localStorage.setItem(FIRST_NAME_KEY, firstName);
  }

  setLastName(lastName: string): void {
    this.lastNameSignal.set(lastName);
    localStorage.setItem(LAST_NAME_KEY, lastName);
  }

  logout(): void {
    this.loggedInSignal.set(false);
    localStorage.removeItem(AUTH_KEY);
    this.tokenSignal.set('');
    localStorage.removeItem(TOKEN_KEY);
    this.roleSignal.set('');
    localStorage.removeItem(ROLE_KEY);
    this.emailSignal.set('');
    localStorage.removeItem(EMAIL_KEY);
    this.departmentSignal.set('');
    localStorage.removeItem(DEPARTMENT_KEY);
    this.firstNameSignal.set('');
    localStorage.removeItem(FIRST_NAME_KEY);
    this.lastNameSignal.set('');
    localStorage.removeItem(LAST_NAME_KEY);
  }

  private loadInitialState(): boolean {
    return localStorage.getItem(AUTH_KEY) === 'true';
  }

  private loadToken(): string {
    return localStorage.getItem(TOKEN_KEY) ?? '';
  }

  private loadRole(): string {
    return localStorage.getItem(ROLE_KEY) ?? '';
  }

  private loadEmail(): string {
    return localStorage.getItem(EMAIL_KEY) ?? '';
  }

  private loadDepartment(): string {
    return localStorage.getItem(DEPARTMENT_KEY) ?? '';
  }

  private loadFirstName(): string {
    return localStorage.getItem(FIRST_NAME_KEY) ?? '';
  }

  private loadLastName(): string {
    return localStorage.getItem(LAST_NAME_KEY) ?? '';
  }
}
