import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';

import { ZardButtonComponent } from '@/components/button/button.component';
import { AuthService } from '@/core/auth/auth.service';

@Component({
  selector: 'app-home',
  imports: [ZardButtonComponent],
  templateUrl: './home.html',
})
export class Home {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  protected logout(): void {
    this.auth.logout();
    this.router.navigateByUrl('/login');
  }
}
