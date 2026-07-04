import { Routes } from '@angular/router';

import { authGuard } from '@/core/auth/auth.guard';
import { CampaignList } from '@/features/campaigns/campaign-list';
import { Login } from '@/features/login/login';
import { SearchResults } from '@/features/search/search-results';
import { Shell } from '@/features/shell/shell';
import { Workspace } from '@/features/workspace/workspace';

export const routes: Routes = [
  { path: 'login', component: Login },
  {
    path: '',
    component: Shell,
    canActivate: [authGuard],
    children: [
      { path: '', redirectTo: 'campaigns', pathMatch: 'full' },
      { path: 'search', component: SearchResults },
      { path: 'campaigns', component: CampaignList },
      // Opening a campaign lands straight in its workspace (notes + character side by side).
      { path: 'campaigns/:campaignId', component: Workspace },
    ],
  },
  { path: '**', redirectTo: '' },
];
