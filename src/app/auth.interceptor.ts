import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError } from 'rxjs';
import { AuthState } from './auth-state';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthState);
  const router = inject(Router);
  const token = auth.accessToken();
  const request = token
    ? req.clone({
        setHeaders: {
          Authorization: `Bearer ${token}`,
        },
      })
    : req;
  return next(request).pipe(
    catchError((error: unknown) => {
      if (error instanceof HttpErrorResponse && error.status === 401) {
        auth.logout();
        router.navigate(['/login']);
      }
      throw error;
    })
  );
};
