import { Routes } from '@angular/router';

import { authGuard } from '@/core/auth/auth.guard';
import { CampaignList } from '@/features/campaigns/campaign-list';
import { Codex } from '@/features/entities/codex';
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
      // AI Q&A over the campaign's notes (RAG) lives as an "Ask" tab inside the notes editor.
      { path: 'campaigns/:campaignId', component: Workspace },
      // The Codex: manage the campaign's tagged entities and their groups.
      { path: 'campaigns/:campaignId/entities', component: Codex },
    ],
  },
  { path: '**', redirectTo: '' },
];
