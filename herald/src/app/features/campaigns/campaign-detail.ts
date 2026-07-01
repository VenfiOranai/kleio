import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import { ZardButtonComponent } from '@/components/button/button.component';
import { ZardCardComponent } from '@/components/card/card.component';
import { CampaignService } from '@/core/api/campaign.service';
import { CharacterService } from '@/core/api/character.service';
import { Campaign, Character, Session } from '@/core/api/models';
import { SessionService } from '@/core/api/session.service';

@Component({
  selector: 'app-campaign-detail',
  imports: [RouterLink, ZardButtonComponent, ZardCardComponent],
  templateUrl: './campaign-detail.html',
})
export class CampaignDetail {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly campaignService = inject(CampaignService);
  private readonly sessionService = inject(SessionService);
  private readonly characterService = inject(CharacterService);

  protected readonly campaignId = Number(this.route.snapshot.paramMap.get('campaignId'));
  protected readonly campaign = signal<Campaign | null>(null);
  protected readonly sessions = signal<Session[]>([]);
  protected readonly characters = signal<Character[]>([]);

  constructor() {
    this.campaignService.get(this.campaignId).subscribe((c) => this.campaign.set(c));
    this.sessionService.list(this.campaignId).subscribe((s) => this.sessions.set(s));
    this.characterService.list(this.campaignId).subscribe((c) => this.characters.set(c));
  }

  protected addSession(): void {
    this.sessionService
      .create(this.campaignId, { title: 'Untitled session' })
      .subscribe((s) =>
        this.router.navigate(['/campaigns', this.campaignId, 'sessions', s.id]),
      );
  }

  protected addCharacter(): void {
    this.characterService
      .create(this.campaignId, { name: 'New character' })
      .subscribe((c) =>
        this.router.navigate(['/campaigns', this.campaignId, 'characters', c.id]),
      );
  }
}
