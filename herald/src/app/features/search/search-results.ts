import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { SearchResult } from '@/core/api/models';
import { SearchService } from '@/core/api/search.service';

@Component({
  selector: 'app-search-results',
  imports: [RouterLink],
  templateUrl: './search-results.html',
})
export class SearchResults {
  private readonly service = inject(SearchService);

  /** Bound from the `?q=` query param via the router's component input binding. */
  readonly q = input('');

  protected readonly results = signal<SearchResult[]>([]);
  protected readonly loading = signal(false);
  protected readonly query = signal('');

  protected readonly sessions = computed(() =>
    this.results().filter((r) => r.type === 'session'),
  );
  protected readonly characters = computed(() =>
    this.results().filter((r) => r.type === 'character'),
  );

  constructor() {
    // Re-run the search whenever the query param changes.
    effect(() => {
      const q = this.q().trim();
      this.query.set(q);
      if (!q) {
        this.results.set([]);
        return;
      }
      this.loading.set(true);
      this.service.search(q).subscribe((res) => {
        this.results.set(res.results);
        this.loading.set(false);
      });
    });
  }
}
