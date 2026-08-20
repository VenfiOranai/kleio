import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Observable, of, shareReplay } from 'rxjs';

import {
  ReferenceFacets,
  ReferenceFetchStatus,
  ReferenceRecord,
  ReferenceSearchResponse,
  ReferenceStatus,
  ReferenceType,
} from './models';

/** Everything the reference browser can narrow by; unset keys simply don't filter. */
export interface ReferenceQuery {
  type: ReferenceType;
  q?: string;
  sort?: string;
  direction?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
  level?: number[];
  school?: string;
  class?: string;
  ritual?: boolean;
  concentration?: boolean;
  category?: string;
  rarity?: string;
  attunement?: boolean;
  weapons_only?: boolean;
  kind?: string;
}

/**
 * The 5etools reference index (Phase 13). The dataset is user-supplied, so import may simply
 * be unavailable: `status` is fetched once and every Browse button hides while it's false.
 * Facets are cached per type — they only change when the mounted dataset does.
 */
@Injectable({ providedIn: 'root' })
export class ReferenceService {
  private readonly http = inject(HttpClient);

  /** Whether the oracle has a dataset loaded; false until the one-off status call answers. */
  readonly available = signal(false);
  readonly counts = signal<ReferenceStatus['counts']>({});
  /** Non-empty when the oracle reads the user's own copy (so downloading isn't offered). */
  readonly configuredDir = signal('');

  private readonly facetCache = new Map<ReferenceType, Observable<ReferenceFacets>>();
  private statusRequested = false;

  /**
   * Ask the oracle whether a dataset is loaded — once per session, lazily.
   *
   * Called when a section modal opens rather than at construction, so a sheet that is never
   * opened for editing costs no request (and specs that don't touch the modals see none).
   */
  ensureStatus(): void {
    if (this.statusRequested) return;
    this.statusRequested = true;
    this.refreshStatus();
  }

  /** Re-ask unconditionally — used after a download finishes. */
  refreshStatus(): void {
    this.statusRequested = true;
    this.http.get<ReferenceStatus>('/api/reference/status').subscribe({
      next: (status) => {
        this.available.set(status.available);
        this.counts.set(status.counts ?? {});
        this.configuredDir.set(status.configured_dir ?? '');
        // A new dataset means new filter values.
        this.facetCache.clear();
      },
      // A failed status call just means no import — the sheet is unaffected.
      error: () => this.available.set(false),
    });
  }

  /** Progress of the optional dataset download. */
  fetchStatus(): Observable<ReferenceFetchStatus> {
    return this.http.get<ReferenceFetchStatus>('/api/reference/fetch');
  }

  /** Start the download; 409s when one is running or a dataset dir is already configured. */
  startFetch(): Observable<ReferenceFetchStatus> {
    return this.http.post<ReferenceFetchStatus>('/api/reference/fetch', {});
  }

  facets(type: ReferenceType): Observable<ReferenceFacets> {
    if (!this.facetCache.has(type)) {
      this.facetCache.set(
        type,
        this.http
          .get<ReferenceFacets>('/api/reference/facets', { params: new HttpParams().set('type', type) })
          .pipe(shareReplay({ bufferSize: 1, refCount: false })),
      );
    }
    return this.facetCache.get(type)!;
  }

  search(query: ReferenceQuery): Observable<ReferenceSearchResponse> {
    if (!this.available()) return of({ total: 0, results: [] });
    let params = new HttpParams();
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === '') continue;
      if (Array.isArray(value)) {
        for (const item of value) params = params.append(key, item);
      } else {
        params = params.set(key, value);
      }
    }
    return this.http.get<ReferenceSearchResponse>('/api/reference/search', { params });
  }

  record(type: ReferenceType, id: string): Observable<ReferenceRecord> {
    return this.http.get<ReferenceRecord>(`/api/reference/${type}/${encodeURIComponent(id)}`);
  }
}
