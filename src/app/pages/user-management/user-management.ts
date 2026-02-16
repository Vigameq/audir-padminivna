import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { FormsModule, NgForm } from '@angular/forms';
import { DepartmentService } from '../../services/department.service';
import { User, UserService } from '../../services/user.service';

type UserRow = {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  department: string;
  role: string;
  status: string;
  lastActive: string;
};

@Component({
  selector: 'app-user-management',
  imports: [CommonModule, FormsModule],
  templateUrl: './user-management.html',
  styleUrl: './user-management.scss',
})
export class UserManagement implements OnInit {
  private readonly userService = inject(UserService);
  private readonly departmentService = inject(DepartmentService);

  protected showInviteModal = false;
  protected showEditModal = false;
  protected selectedUser: UserRow | null = null;
  protected searchTerm = '';
  protected roleFilter = '';
  protected onboardError = '';
  protected onboardForm = {
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    department: '',
    role: '',
    status: '',
    password: '',
  };

  protected readonly roles = ['Auditor', 'Manager', 'Super Admin', 'Customer'];
  protected users: UserRow[] = [];
  protected get departments(): string[] {
    return this.departmentService.departments();
  }

  protected editForm: UserRow | null = null;

  ngOnInit(): void {
    this.departmentService.migrateFromLocal().subscribe();
    this.loadUsers();
  }

  protected openInvite(): void {
    this.showInviteModal = true;
  }

  protected closeInvite(): void {
    this.showInviteModal = false;
  }

  protected onboardUser(form: NgForm): void {
    if (form.invalid) {
      return;
    }
    this.onboardError = '';
    this.userService
      .createUser({
        first_name: this.onboardForm.firstName,
        last_name: this.onboardForm.lastName,
        email: this.onboardForm.email,
        phone: this.onboardForm.phone || null,
        department: this.onboardForm.department,
        role: this.onboardForm.role,
        status: this.onboardForm.status,
        password: this.onboardForm.password,
      })
      .subscribe({
        next: (created) => {
          this.users.unshift(this.mapUser(created));
          form.resetForm();
          this.showInviteModal = false;
        },
        error: () => {
          this.onboardError = 'Unable to onboard user. Please try again.';
        },
      });
  }

  protected openEdit(user: UserRow): void {
    this.selectedUser = { ...user };
    this.editForm = { ...user };
    this.showEditModal = true;
  }

  protected closeEdit(): void {
    this.showEditModal = false;
    this.selectedUser = null;
    this.editForm = null;
  }

  protected saveEdit(): void {
    if (!this.editForm) {
      return;
    }
    this.userService
      .updateUser(this.editForm.id, {
        first_name: this.editForm.firstName,
        last_name: this.editForm.lastName,
        phone: this.editForm.phone || null,
        department: this.editForm.department,
        role: this.editForm.role,
        status: this.editForm.status,
      })
      .subscribe({
        next: (updated) => {
          const index = this.users.findIndex((user) => user.id === updated.id);
          if (index >= 0) {
            this.users[index] = this.mapUser(updated);
          }
          this.closeEdit();
        },
      });
  }

  protected get filteredUsers(): UserRow[] {
    const term = this.searchTerm.trim().toLowerCase();
    return this.users.filter((user) => {
      const matchesTerm =
        !term ||
        `${user.firstName} ${user.lastName}`.toLowerCase().includes(term) ||
        user.email.toLowerCase().includes(term);
      const matchesRole = !this.roleFilter || user.role === this.roleFilter;
      return matchesTerm && matchesRole;
    });
  }

  protected resetPassword(user: UserRow): void {
    const newPassword = window.prompt(
      `Enter a new password for ${user.firstName} ${user.lastName}`
    );
    if (!newPassword) {
      return;
    }
    this.userService.resetPassword(user.id, newPassword).subscribe({
      next: () => {
        const target = this.users.find((entry) => entry.id === user.id);
        if (target) {
          target.lastActive = 'Password reset sent';
        }
      },
    });
  }

  protected deleteUser(user: UserRow): void {
    const confirmed = window.confirm(
      `Delete ${user.firstName} ${user.lastName}? This cannot be undone.`
    );
    if (!confirmed) {
      return;
    }
    this.userService.deleteUser(user.id).subscribe({
      next: () => {
        this.users = this.users.filter((entry) => entry.id !== user.id);
      },
    });
  }

  private loadUsers(): void {
    this.userService.listUsers().subscribe({
      next: (users) => {
        this.users = users.map((user) => this.mapUser(user));
      },
    });
  }

  private mapUser(user: User): UserRow {
    return {
      id: user.id,
      firstName: user.first_name ?? '',
      lastName: user.last_name ?? '',
      email: user.email,
      phone: user.phone ?? undefined,
      department: user.department ?? '',
      role: user.role,
      status: user.status,
      lastActive: this.formatLastActive(user.last_active),
    };
  }

  private formatLastActive(value?: string | null): string {
    if (!value) {
      return '—';
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return value;
    }
    return date.toLocaleDateString();
  }
}
