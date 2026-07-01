import { Routes } from '@angular/router';

import { authGuard } from '@/core/auth/auth.guard';
import { CampaignDetail } from '@/features/campaigns/campaign-detail';
import { CampaignList } from '@/features/campaigns/campaign-list';
import { CharacterSheet } from '@/features/characters/character-sheet';
import { Login } from '@/features/login/login';
import { SessionEditor } from '@/features/sessions/session-editor';
import { Shell } from '@/features/shell/shell';

export const routes: Routes = [
  { path: 'login', component: Login },
  {
    path: '',
    component: Shell,
    canActivate: [authGuard],
    children: [
      { path: '', redirectTo: 'campaigns', pathMatch: 'full' },
      { path: 'campaigns', component: CampaignList },
      { path: 'campaigns/:campaignId', component: CampaignDetail },
      { path: 'campaigns/:campaignId/sessions/:sessionId', component: SessionEditor },
      { path: 'campaigns/:campaignId/characters/:characterId', component: CharacterSheet },
    ],
  },
  { path: '**', redirectTo: '' },
];
