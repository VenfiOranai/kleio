import { Component, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { Router, RouterLink, RouterOutlet } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideMoon, lucideSun } from '@ng-icons/lucide';

import { ZardButtonComponent } from '@/components/button/button.component';
import { ZardInputDirective } from '@/components/input/input.directive';
import { AuthService } from '@/core/auth/auth.service';
import { ThemeService } from '@/core/theme/theme.service';

@Component({
  selector: 'app-shell',
  imports: [
    RouterOutlet,
    RouterLink,
    ReactiveFormsModule,
    NgIcon,
    ZardButtonComponent,
    ZardInputDirective,
  ],
  viewProviders: [provideIcons({ lucideSun, lucideMoon })],
  templateUrl: './shell.html',
})
export class Shell {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder);
  protected readonly themeService = inject(ThemeService);

  protected readonly form = this.fb.nonNullable.group({ q: [''] });

  protected submitSearch(): void {
    const q = this.form.controls.q.value.trim();
    if (!q) return;
    this.router.navigate(['/search'], { queryParams: { q } });
  }

  protected logout(): void {
    this.auth.logout();
    this.router.navigateByUrl('/login');
  }
}
