import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';

type TokenResponse = {
  access_token: string;
  token_type: string;
};

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly baseUrl = '/api';

  constructor(private readonly http: HttpClient) {}

  login(email: string, password: string): Observable<TokenResponse> {
    const body = new HttpParams()
      .set('username', email)
      .set('password', password);
    return this.http
      .post<TokenResponse>(`${this.baseUrl}/auth/login`, body.toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });
  }
}
