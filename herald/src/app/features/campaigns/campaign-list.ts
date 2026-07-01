import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { ZardButtonComponent } from '@/components/button/button.component';
import { ZardCardComponent } from '@/components/card/card.component';
import { ZardInputDirective } from '@/components/input/input.directive';
import { CampaignService } from '@/core/api/campaign.service';
import { Campaign } from '@/core/api/models';

@Component({
  selector: 'app-campaign-list',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    ZardButtonComponent,
    ZardCardComponent,
    ZardInputDirective,
  ],
  templateUrl: './campaign-list.html',
})
export class CampaignList {
  private readonly service = inject(CampaignService);
  private readonly fb = inject(FormBuilder);

  protected readonly campaigns = signal<Campaign[]>([]);
  protected readonly form = this.fb.nonNullable.group({
    name: ['', Validators.required],
    description: [''],
  });

  constructor() {
    this.service.list().subscribe((campaigns) => this.campaigns.set(campaigns));
  }

  protected create(): void {
    if (this.form.invalid) return;
    this.service.create(this.form.getRawValue()).subscribe((created) => {
      this.campaigns.update((list) => [...list, created]);
      this.form.reset({ name: '', description: '' });
    });
  }

  protected remove(id: number, event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    this.service.delete(id).subscribe(() => {
      this.campaigns.update((list) => list.filter((c) => c.id !== id));
    });
  }
}
