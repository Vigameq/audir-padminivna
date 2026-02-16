import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthState } from '../../auth-state';
import { AuthService } from '../../services/auth.service';
import { DataSyncService } from '../../services/data-sync.service';
import { UserService } from '../../services/user.service';

@Component({
  selector: 'app-login',
  imports: [CommonModule, FormsModule],
  templateUrl: './login.html',
  styleUrl: './login.scss',
})
export class Login {
  private readonly router = inject(Router);
  private readonly auth = inject(AuthState);
  private readonly authService = inject(AuthService);
  private readonly dataSync = inject(DataSyncService);
  private readonly userService = inject(UserService);

  protected email = '';
  protected password = '';
  protected loginError = '';

  protected signIn(): void {
    this.loginError = '';
    this.authService.login(this.email, this.password).subscribe({
      next: (token) => {
        this.auth.login(token.access_token, undefined, this.email);
        this.userService.listUsers().subscribe({
          next: (users) => {
            const match = users.find(
              (user) => user.email.toLowerCase() === this.email.trim().toLowerCase()
            );
            const role = match?.role || 'Auditor';
            this.auth.login(token.access_token, role, this.email);
            this.auth.setDepartment(match?.department ?? '');
            this.auth.setFirstName(match?.first_name ?? '');
            this.auth.setLastName(match?.last_name ?? '');
            this.dataSync.syncAll().subscribe({
              next: () =>
                this.router.navigate([role === 'Customer' ? '/customer-dashboard' : '/dashboard']),
              error: () =>
                this.router.navigate([role === 'Customer' ? '/customer-dashboard' : '/dashboard']),
            });
          },
          error: () => {
            this.auth.login(token.access_token, 'Auditor', this.email);
            this.dataSync.syncAll().subscribe({
              next: () => this.router.navigate(['/dashboard']),
              error: () => this.router.navigate(['/dashboard']),
            });
          },
        });
      },
      error: () => {
        this.loginError = 'Invalid credentials. Please try again.';
      },
    });
  }
}
