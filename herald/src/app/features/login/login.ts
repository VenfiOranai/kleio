import { Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';

import { ZardButtonComponent } from '@/components/button/button.component';
import { ZardCardComponent } from '@/components/card/card.component';
import { ZardInputDirective } from '@/components/input/input.directive';
import { AuthService } from '@/core/auth/auth.service';

@Component({
  selector: 'app-login',
  imports: [ZardButtonComponent, ZardCardComponent, ZardInputDirective],
  templateUrl: './login.html',
})
export class Login {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  protected readonly username = signal('');
  protected readonly password = signal('');
  protected readonly error = signal<string | null>(null);
  protected readonly loading = signal(false);

  protected setUsername(value: string | number | null | undefined): void {
    this.username.set(value == null ? '' : String(value));
  }

  protected setPassword(value: string | number | null | undefined): void {
    this.password.set(value == null ? '' : String(value));
  }

  protected submit(event: Event): void {
    event.preventDefault();
    this.error.set(null);
    this.loading.set(true);
    this.auth.login({ username: this.username(), password: this.password() }).subscribe({
      next: () => this.router.navigateByUrl('/'),
      error: () => {
        this.error.set('Invalid username or password.');
        this.loading.set(false);
      },
    });
  }
}
