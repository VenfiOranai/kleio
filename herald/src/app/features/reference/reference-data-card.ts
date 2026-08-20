import { HttpErrorResponse } from '@angular/common/http';
import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subscription, interval, switchMap } from 'rxjs';

import { ZardButtonComponent } from '@/components/button/button.component';
import { ZardCardComponent } from '@/components/card/card.component';
import { ReferenceFetchStatus } from '@/core/api/models';
import { ReferenceService } from '@/core/api/reference.service';

const POLL_MS = 1500;

/**
 * Set-up card for the 5etools reference browser (Phase 13).
 *
 * Kleio ships no game data, so reference import is off until a dataset exists. This offers the
 * one-shot download — `POST /api/reference/fetch` runs it on the oracle in the background —
 * and reports progress, so the feature can be enabled without touching the server. When
 * `FIVETOOLS_DATA_DIR` points at the user's own copy, downloading isn't offered at all
 * (the oracle would ignore it).
 */
@Component({
  selector: 'app-reference-data-card',
  imports: [ZardButtonComponent, ZardCardComponent],
  templateUrl: './reference-data-card.html',
})
export class ReferenceDataCard {
  private readonly service = inject(ReferenceService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly available = this.service.available;
  protected readonly counts = this.service.counts;
  protected readonly configuredDir = this.service.configuredDir;

  protected readonly fetch = signal<ReferenceFetchStatus | null>(null);
  protected readonly error = signal<string | null>(null);

  protected readonly running = computed(() => this.fetch()?.state === 'running');
  protected readonly percent = computed(() => {
    const status = this.fetch();
    if (!status?.total) return 0;
    return Math.round((status.downloaded / status.total) * 100);
  });

  /** The loaded dataset, as "361 spells · 2,048 items · 120 feats & features". */
  protected readonly summary = computed(() => {
    const counts = this.counts();
    return [
      [counts.spell, 'spells'],
      [counts.item, 'items'],
      [counts.feature, 'feats & features'],
    ]
      .filter(([count]) => !!count)
      .map(([count, label]) => `${(count as number).toLocaleString()} ${label}`)
      .join(' · ');
  });

  private poller?: Subscription;

  constructor() {
    this.service.refreshStatus();
    // A download started before a reload is still running on the server — pick it back up.
    this.service.fetchStatus().subscribe((status) => {
      this.fetch.set(status.state === 'idle' ? null : status);
      if (status.state === 'running') this.poll();
    });
  }

  protected download(): void {
    this.error.set(null);
    this.service.startFetch().subscribe({
      next: (status) => {
        this.fetch.set(status);
        this.poll();
      },
      error: (err: HttpErrorResponse) =>
        this.error.set(err.error?.detail ?? 'Could not start the download.'),
    });
  }

  /** Follow the job until it stops, then refresh what the rest of the app knows. */
  private poll(): void {
    this.poller?.unsubscribe();
    this.poller = interval(POLL_MS)
      .pipe(
        switchMap(() => this.service.fetchStatus()),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (status) => {
          this.fetch.set(status);
          if (status.state === 'running') return;
          this.poller?.unsubscribe();
          if (status.state === 'done') this.service.refreshStatus();
        },
        error: () => {
          this.poller?.unsubscribe();
          this.error.set('Lost track of the download. Reload to check on it.');
        },
      });
  }
}
