import { Routes } from '@angular/router';

import { authGuard } from '@/core/auth/auth.guard';
import { Home } from '@/features/home/home';
import { Login } from '@/features/login/login';

export const routes: Routes = [
  { path: 'login', component: Login },
  { path: '', component: Home, canActivate: [authGuard] },
  { path: '**', redirectTo: '' },
];
