import { Component, computed, inject, output, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, catchError, debounceTime, of, switchMap } from 'rxjs';

import { ZardButtonComponent } from '@/components/button/button.component';
import { ZardInputDirective } from '@/components/input/input.directive';
import { ReferenceRecord, ReferenceSummary, ReferenceType } from '@/core/api/models';
import { ReferenceQuery, ReferenceService } from '@/core/api/reference.service';
import { MarkdownView } from '@/shared/markdown-view/markdown-view';
import { Modal } from '@/shared/modal/modal';

/** How the browser was opened — one modal serves every "add" button on the sheet. */
export interface ReferenceBrowseOptions {
  /** Restrict an item browse to weapons (the attacks panel only wants those). */
  weaponsOnly?: boolean;
  /** Override the modal heading; defaults to a per-type label. */
  title?: string;
}

const PAGE_SIZE = 50;

const DEFAULT_TITLES: Record<ReferenceType, string> = {
  spell: 'Browse spells',
  item: 'Browse items',
  feature: 'Browse feats & features',
};

/** Readable labels for the sort fields the oracle offers per type. */
const SORT_LABELS: Record<string, string> = {
  relevance: 'Best match',
  name: 'Name',
  level: 'Level',
  school: 'School',
  source: 'Source',
  category: 'Category',
  rarity: 'Rarity',
  value: 'Price',
  weight: 'Weight',
  kind: 'Kind',
};

/**
 * The shared 5etools reference browser.
 *
 * One modal for every structured section: `open('spell' | 'item' | 'feature')` picks which
 * slice of the index is listed and which filters/sorts are offered, and picking a result
 * emits the full normalized record for the host to fold into its own list. The host keeps
 * ownership of the entry afterwards — imports are always editable.
 */
@Component({
  selector: 'app-reference-modal',
  imports: [Modal, ZardButtonComponent, ZardInputDirective, MarkdownView],
  templateUrl: './reference-modal.html',
})
export class ReferenceModal {
  private readonly service = inject(ReferenceService);

  /** The full record the user picked; the host maps it into its own entry list. */
  readonly picked = output<ReferenceRecord>();

  private readonly modal = viewChild.required(Modal);

  protected readonly available = this.service.available;
  protected readonly sortLabels = SORT_LABELS;

  protected readonly type = signal<ReferenceType>('spell');
  protected readonly title = signal(DEFAULT_TITLES.spell);
  protected readonly weaponsOnly = signal(false);

  // --- Query state ---------------------------------------------------------
  protected readonly q = signal('');
  protected readonly sort = signal('relevance');
  protected readonly direction = signal<'asc' | 'desc'>('asc');
  /** -1 = every level. */
  protected readonly level = signal(-1);
  protected readonly school = signal('');
  protected readonly klass = signal('');
  protected readonly ritual = signal(false);
  protected readonly concentration = signal(false);
  protected readonly category = signal('');
  protected readonly rarity = signal('');
  protected readonly attunement = signal(false);
  protected readonly kind = signal('');

  // --- Results -------------------------------------------------------------
  protected readonly results = signal<ReferenceSummary[]>([]);
  protected readonly total = signal(0);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);

  /** Filter values offered for the current type, straight from the loaded dataset. */
  protected readonly levels = signal<number[]>([]);
  protected readonly schools = signal<string[]>([]);
  protected readonly classes = signal<string[]>([]);
  protected readonly categories = signal<string[]>([]);
  protected readonly rarities = signal<string[]>([]);
  protected readonly kinds = signal<string[]>([]);
  protected readonly sorts = signal<string[]>(['relevance', 'name']);

  /** Expanded row (its full record is fetched on demand and cached). */
  protected readonly expandedId = signal<string | null>(null);
  private readonly records = new Map<string, ReferenceRecord>();
  protected readonly detail = signal<ReferenceRecord | null>(null);
  protected readonly detailLoading = signal(false);

  /** Ids added during this visit, so a list of picks reads back at a glance. */
  protected readonly added = signal<Set<string>>(new Set());

  protected readonly hasMore = computed(() => this.results().length < this.total());

  private readonly requery = new Subject<void>();

  constructor() {
    this.requery
      .pipe(
        debounceTime(200),
        switchMap(() =>
          this.service.search(this.query(0)).pipe(
            catchError(() => {
              this.error.set('Reference lookup failed. Please try again.');
              return of({ total: 0, results: [] });
            }),
          ),
        ),
        takeUntilDestroyed(),
      )
      .subscribe((response) => {
        this.loading.set(false);
        this.results.set(response.results);
        this.total.set(response.total);
      });
  }

  open(type: ReferenceType, options: ReferenceBrowseOptions = {}): void {
    this.type.set(type);
    this.weaponsOnly.set(!!options.weaponsOnly);
    this.title.set(options.title ?? DEFAULT_TITLES[type]);
    this.resetFilters();
    this.results.set([]);
    this.total.set(0);
    this.added.set(new Set());
    this.collapse();
    this.loadFacets(type);
    this.search();
    this.modal().open();
  }

  private resetFilters(): void {
    this.q.set('');
    this.sort.set('relevance');
    this.direction.set('asc');
    this.level.set(-1);
    this.school.set('');
    this.klass.set('');
    this.ritual.set(false);
    this.concentration.set(false);
    this.category.set('');
    this.rarity.set('');
    this.attunement.set(false);
    this.kind.set('');
    this.error.set(null);
  }

  private loadFacets(type: ReferenceType): void {
    this.service.facets(type).subscribe({
      next: (facets) => {
        this.levels.set(facets.levels ?? []);
        this.schools.set(facets.schools ?? []);
        this.classes.set(facets.classes ?? []);
        this.categories.set(facets.categories ?? []);
        this.rarities.set(facets.rarities ?? []);
        this.kinds.set(facets.kinds ?? []);
        this.sorts.set(facets.sorts?.length ? facets.sorts : ['relevance', 'name']);
      },
      // Filters are a convenience; searching still works without them.
      error: () => this.sorts.set(['relevance', 'name']),
    });
  }

  /** The current control state as a query. Booleans are only sent when *on* — sending
   * `ritual=false` would mean "non-rituals only" rather than "don't care". */
  private query(offset: number): ReferenceQuery {
    const type = this.type();
    const query: ReferenceQuery = {
      type,
      q: this.q().trim(),
      sort: this.sort(),
      direction: this.direction(),
      limit: PAGE_SIZE,
      offset,
    };
    if (type === 'spell') {
      if (this.level() >= 0) query.level = [this.level()];
      query.school = this.school();
      query.class = this.klass();
      if (this.ritual()) query.ritual = true;
      if (this.concentration()) query.concentration = true;
    } else if (type === 'item') {
      query.category = this.category();
      query.rarity = this.rarity();
      if (this.attunement()) query.attunement = true;
      if (this.weaponsOnly()) query.weapons_only = true;
    } else {
      query.kind = this.kind();
    }
    return query;
  }

  /** Re-run the search (debounced, and cancelling any in-flight request). */
  protected search(): void {
    this.loading.set(true);
    this.error.set(null);
    this.collapse();
    this.requery.next();
  }

  protected setSort(value: string): void {
    this.sort.set(value);
    this.search();
  }

  protected toggleDirection(): void {
    this.direction.update((d) => (d === 'asc' ? 'desc' : 'asc'));
    this.search();
  }

  protected loadMore(): void {
    this.loading.set(true);
    this.service.search(this.query(this.results().length)).subscribe({
      next: (response) => {
        this.loading.set(false);
        this.results.update((rows) => [...rows, ...response.results]);
        this.total.set(response.total);
      },
      error: () => {
        this.loading.set(false);
        this.error.set('Reference lookup failed. Please try again.');
      },
    });
  }

  // --- Detail + import -----------------------------------------------------

  private collapse(): void {
    this.expandedId.set(null);
    this.detail.set(null);
    this.detailLoading.set(false);
  }

  /** Clicking a row opens its full entry underneath — fetched once, then cached. */
  protected toggleDetail(row: ReferenceSummary): void {
    if (this.expandedId() === row.id) {
      this.collapse();
      return;
    }
    this.expandedId.set(row.id);
    const cached = this.records.get(row.id);
    if (cached) {
      this.detail.set(cached);
      return;
    }
    this.detail.set(null);
    this.detailLoading.set(true);
    this.fetch(row, (record) => {
      // Ignore a response that arrived after the user moved on.
      if (this.expandedId() === row.id) this.detail.set(record);
      this.detailLoading.set(false);
    });
  }

  /** Import the row — the modal stays open so several picks can be made in one visit. */
  protected add(row: ReferenceSummary): void {
    this.fetch(row, (record) => {
      this.picked.emit(record);
      this.added.update((ids) => new Set(ids).add(row.id));
    });
  }

  private fetch(row: ReferenceSummary, then: (record: ReferenceRecord) => void): void {
    const cached = this.records.get(row.id);
    if (cached) {
      then(cached);
      return;
    }
    this.service.record(row.type, row.id).subscribe({
      next: (record) => {
        this.records.set(row.id, record);
        then(record);
      },
      error: () => {
        this.detailLoading.set(false);
        this.error.set(`Could not load "${row.name}".`);
      },
    });
  }

  protected isAdded(row: ReferenceSummary): boolean {
    return this.added().has(row.id);
  }

  /** The description shown in an expanded row, whichever payload the record carries. */
  protected readonly detailMarkdown = computed(() => {
    const record = this.detail();
    const payload = record?.spell ?? record?.item ?? record?.feature ?? null;
    if (!payload) return '';
    const higher = record?.spell?.at_higher_levels;
    return higher
      ? `${payload.description}\n\n**At Higher Levels.** ${higher}`
      : payload.description;
  });

  /** Spell/item stat lines worth showing above the description in an expanded row. */
  protected readonly detailStats = computed(() => {
    const spell = this.detail()?.spell;
    if (!spell) return [];
    return [
      ['Casting time', spell.casting_time],
      ['Range', spell.range],
      ['Components', spell.components],
      ['Duration', spell.duration],
    ].filter(([, value]) => !!value) as [string, string][];
  });

  protected close(): void {
    this.modal().close();
  }
}
