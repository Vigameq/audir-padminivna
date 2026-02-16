import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { AuthState } from '../auth-state';

export type User = {
  id: number;
  first_name?: string | null;
  last_name?: string | null;
  email: string;
  phone?: string | null;
  department?: string | null;
  role: string;
  status: string;
  last_active?: string | null;
};

export type UserCreate = {
  first_name?: string | null;
  last_name?: string | null;
  email: string;
  phone?: string | null;
  department?: string | null;
  role: string;
  status: string;
  password: string;
};

export type UserUpdate = {
  first_name?: string | null;
  last_name?: string | null;
  phone?: string | null;
  department?: string | null;
  role?: string | null;
  status?: string | null;
};

@Injectable({ providedIn: 'root' })
export class UserService {
  private readonly baseUrl = '/api';

  constructor(
    private readonly http: HttpClient,
    private readonly auth: AuthState
  ) {}

  listUsers(): Observable<User[]> {
    return this.http.get<User[]>(`${this.baseUrl}/users`, {
      headers: this.authHeaders(),
    });
  }

  createUser(payload: UserCreate): Observable<User> {
    return this.http.post<User>(`${this.baseUrl}/users`, payload, {
      headers: this.authHeaders(),
    });
  }

  updateUser(userId: number, payload: UserUpdate): Observable<User> {
    return this.http.put<User>(`${this.baseUrl}/users/${userId}`, payload, {
      headers: this.authHeaders(),
    });
  }

  resetPassword(userId: number, newPassword: string): Observable<User> {
    return this.http.post<User>(
      `${this.baseUrl}/users/${userId}/reset-password`,
      { new_password: newPassword },
      { headers: this.authHeaders() }
    );
  }

  deleteUser(userId: number): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/users/${userId}`, {
      headers: this.authHeaders(),
    });
  }

  private authHeaders(): HttpHeaders {
    const token = this.auth.accessToken();
    if (!token) {
      return new HttpHeaders();
    }
    return new HttpHeaders({ Authorization: `Bearer ${token}` });
  }
}
