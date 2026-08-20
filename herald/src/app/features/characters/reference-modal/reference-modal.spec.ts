import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, TestRequest, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { ReferenceFacets, ReferenceRecord, ReferenceSummary } from '@/core/api/models';
import { ReferenceService } from '@/core/api/reference.service';

import { ReferenceModal } from './reference-modal';

function makeSummary(overrides: Partial<ReferenceSummary> = {}): ReferenceSummary {
  return {
    id: 'spell-fireball-phb',
    type: 'spell',
    name: 'Fireball',
    source: 'PHB',
    subtitle: 'Level 3 Evocation · Sorcerer, Wizard',
    level: 3,
    school: 'Evocation',
    classes: ['Sorcerer', 'Wizard'],
    ritual: false,
    concentration: false,
    category: '',
    rarity: '',
    value: null,
    weight: null,
    attunement: false,
    weapon: false,
    kind: '',
    ...overrides,
  };
}

function makeRecord(overrides: Partial<ReferenceRecord> = {}): ReferenceRecord {
  return {
    id: 'spell-fireball-phb',
    type: 'spell',
    name: 'Fireball',
    source: 'PHB',
    subtitle: '',
    spell: {
      name: 'Fireball',
      level: 3,
      school: 'Evocation',
      prepared: false,
      always_prepared: false,
      ritual: false,
      concentration: false,
      casting_time: '1 action',
      range: '150 feet',
      components: 'V, S, M (bat guano)',
      duration: 'Instantaneous',
      description: 'A bright streak flashes.',
      at_higher_levels: 'The damage increases by 1d6.',
    },
    item: null,
    feature: null,
    attack: null,
    ...overrides,
  };
}

const NO_FACETS: ReferenceFacets = {
  type: 'spell',
  sorts: ['relevance', 'name', 'level'],
  sources: ['PHB'],
  levels: [0, 3],
  schools: ['Evocation'],
  classes: ['Sorcerer', 'Wizard'],
  categories: [],
  rarities: [],
  kinds: [],
};

describe('ReferenceModal', () => {
  let fixture: ComponentFixture<ReferenceModal>;
  let http: HttpTestingController;
  let picked: ReferenceRecord[];

  const el = (): HTMLElement => fixture.nativeElement;
  const rows = () => [...el().querySelectorAll('[aria-expanded]')] as HTMLButtonElement[];
  const addButtons = () =>
    [...el().querySelectorAll('button')].filter((b) => b.textContent?.trim().startsWith('Add'));

  /** The search request is debounced; let it through and hand back the pending request. */
  function flushSearch(results: ReferenceSummary[], total = results.length): TestRequest {
    vi.advanceTimersByTime(250);
    const request = http.expectOne((r) => r.url === '/api/reference/search');
    request.flush({ total, results });
    fixture.detectChanges();
    return request;
  }

  function open(type: 'spell' | 'item' | 'feature' = 'spell', options = {}): void {
    fixture.componentInstance.open(type, options);
    fixture.detectChanges();
    http.expectOne((r) => r.url === '/api/reference/facets').flush({ ...NO_FACETS, type });
  }

  // jsdom knows the <dialog> element but not its top-layer methods; the modal only needs
  // them to become visible, which the DOM assertions here don't depend on.
  beforeAll(() => {
    const dialog = globalThis.HTMLDialogElement?.prototype as HTMLDialogElement | undefined;
    if (dialog && typeof dialog.showModal !== 'function') {
      dialog.showModal = function (this: HTMLDialogElement) {
        this.open = true;
      };
      dialog.close = function (this: HTMLDialogElement) {
        this.open = false;
        this.dispatchEvent(new Event('close'));
      };
    }
  });

  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.configureTestingModule({
      imports: [ReferenceModal],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    // The browser only offers Browse when a dataset is loaded; assume one is.
    TestBed.inject(ReferenceService).available.set(true);

    fixture = TestBed.createComponent(ReferenceModal);
    picked = [];
    fixture.componentInstance.picked.subscribe((record) => picked.push(record));
    fixture.detectChanges();
  });

  afterEach(() => {
    http.verify();
    vi.useRealTimers();
    fixture.destroy();
  });

  it('lists the results for the requested type', () => {
    open('spell');
    flushSearch([makeSummary(), makeSummary({ id: 'spell-fire-bolt-phb', name: 'Fire Bolt' })], 2);

    const rowNames = rows().map((r) => r.querySelector('.font-medium')?.textContent?.trim());
    expect(rowNames).toEqual(['Fireball', 'Fire Bolt']);
    expect(rows()[0].textContent).toContain('Level 3 Evocation');
    expect(el().textContent).toContain('Showing 2 of 2');
  });

  it('sends the typed query, debounced', () => {
    open('spell');
    flushSearch([]);

    const input = el().querySelector<HTMLInputElement>('input[aria-label="Search reference"]')!;
    input.value = 'fire';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    const request = flushSearch([makeSummary()]);
    expect(request.request.params.get('q')).toBe('fire');
    expect(request.request.params.get('type')).toBe('spell');
  });

  it('folds the spell filters and sort into the query', () => {
    open('spell');
    flushSearch([]);

    const select = (label: string) => el().querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)!;
    const pick = (label: string, value: string) => {
      const element = select(label);
      element.value = value;
      element.dispatchEvent(new Event('change'));
      fixture.detectChanges();
    };

    pick('Filter by level', '3');
    flushSearch([]);
    pick('Filter by class', 'Wizard');
    flushSearch([]);
    pick('Sort by', 'level');

    const request = flushSearch([makeSummary()]);
    expect(request.request.params.getAll('level')).toEqual(['3']);
    expect(request.request.params.get('class')).toBe('Wizard');
    expect(request.request.params.get('sort')).toBe('level');
    // Booleans are only sent when on — `ritual=false` would mean "non-rituals only".
    expect(request.request.params.has('ritual')).toBe(false);
  });

  it('restricts an item browse to weapons when asked', () => {
    open('item', { weaponsOnly: true, title: 'Browse weapons' });
    const request = flushSearch([]);

    expect(request.request.params.get('weapons_only')).toBe('true');
    expect(el().textContent).toContain('Browse weapons');
    // The category filter is meaningless once it's weapons-only.
    expect(el().querySelector('select[aria-label="Filter by category"]')).toBeNull();
  });

  it('fetches a full record once when a row is expanded', () => {
    open('spell');
    flushSearch([makeSummary()]);

    rows()[0].click();
    fixture.detectChanges();
    http.expectOne('/api/reference/spell/spell-fireball-phb').flush(makeRecord());
    fixture.detectChanges();

    expect(el().textContent).toContain('A bright streak flashes.');
    expect(el().textContent).toContain('At Higher Levels');
    expect(el().textContent).toContain('1 action');

    // Collapsing and reopening reuses the cached record.
    rows()[0].click();
    fixture.detectChanges();
    rows()[0].click();
    fixture.detectChanges();
    http.expectNone('/api/reference/spell/spell-fireball-phb');
  });

  it('emits the full record on Add and marks the row', () => {
    open('spell');
    flushSearch([makeSummary()]);

    addButtons()[0].click();
    fixture.detectChanges();
    http.expectOne('/api/reference/spell/spell-fireball-phb').flush(makeRecord());
    fixture.detectChanges();

    expect(picked).toHaveLength(1);
    expect(picked[0].spell?.name).toBe('Fireball');
    expect(addButtons()[0].textContent).toContain('Added');
  });

  it('pages with Load more, keeping the earlier rows', () => {
    open('spell');
    flushSearch([makeSummary()], 2);

    const more = [...el().querySelectorAll('button')].find((b) => b.textContent?.includes('Load more'))!;
    more.click();
    fixture.detectChanges();

    const request = http.expectOne((r) => r.url === '/api/reference/search');
    expect(request.request.params.get('offset')).toBe('1');
    request.flush({ total: 2, results: [makeSummary({ id: 'spell-fire-bolt-phb', name: 'Fire Bolt' })] });
    fixture.detectChanges();

    expect(rows()).toHaveLength(2);
    expect(el().textContent).toContain('Showing 2 of 2');
  });
});
