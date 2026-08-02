import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Character, Feature, Spell } from '@/core/api/models';

import { CharacterSheet } from './character-sheet';

function makeFeature(overrides: Partial<Feature> = {}): Feature {
  return { name: 'Feature', source: 'class', level: null, uses: null, description: '', ...overrides };
}

function makeSpell(overrides: Partial<Spell> = {}): Spell {
  return {
    name: 'Spell',
    level: 0,
    school: '',
    prepared: false,
    always_prepared: false,
    ritual: false,
    concentration: false,
    casting_time: '',
    range: '',
    components: '',
    duration: '',
    description: '',
    ...overrides,
  };
}

function makeCharacter(overrides: Partial<Character> = {}): Character {
  return {
    id: 1,
    campaign_id: 2,
    name: 'Vex',
    class_name: 'Rogue',
    subclass: '',
    level: 4,
    race: '',
    background: '',
    alignment: '',
    xp: 0,
    strength: 10,
    dexterity: 16,
    constitution: 12,
    intelligence: 10,
    wisdom: 10,
    charisma: 14,
    max_hp: 30,
    current_hp: 30,
    temp_hp: 0,
    hit_dice: [{ die: 'd8', total: 4, spent: 0 }],
    armor_class: 15,
    speed: 30,
    saving_throw_proficiencies: ['dexterity'],
    skill_proficiencies: ['stealth'],
    currency: { pp: 0, gp: 10, ep: 0, sp: 0, cp: 0 },
    other_proficiencies: [],
    equipment: [],
    spells: [],
    spell_slots: [],
    features: [],
    attacks: [],
    notes: '',
    created_at: '',
    updated_at: '',
    derived: {
      proficiency_bonus: 2,
      ability_modifiers: {},
      saving_throws: {},
      skills: {},
      passive_perception: 10,
      initiative: 3,
      spellcasting_ability: '',
      spell_attack_bonus: null,
      spell_save_dc: null,
      total_weight: 0,
      carrying_capacity: 150,
      encumbered: false,
      attunement_count: 0,
      attacks: [],
    },
    ...overrides,
  };
}

/** The JSON view is a plain textarea + a toggle button, driven here as a user would. */
describe('CharacterSheet JSON view', () => {
  let fixture: ComponentFixture<CharacterSheet>;
  let http: HttpTestingController;

  const el = (): HTMLElement => fixture.nativeElement;
  const editor = () => el().querySelector<HTMLTextAreaElement>('textarea[aria-label="Character JSON"]');
  const input = (name: string) => el().querySelector<HTMLInputElement>(`input[formcontrolname="${name}"]`)!;

  function toggleJson(): void {
    const button = [...el().querySelectorAll('button')].find((b) => b.textContent?.trim() === 'JSON');
    button!.click();
    fixture.detectChanges();
  }

  /** Type into a control the way the DOM would, so the reactive form picks the value up. */
  function type(element: HTMLInputElement | HTMLTextAreaElement, value: string): void {
    element.value = value;
    element.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  function currentJson(): Record<string, unknown> {
    return JSON.parse(editor()!.value);
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [CharacterSheet],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    http = TestBed.inject(HttpTestingController);

    fixture = TestBed.createComponent(CharacterSheet);
    fixture.componentRef.setInput('characterId', 1);
    fixture.componentRef.setInput('campaignId', 2);
    fixture.detectChanges();
    http.expectOne('/api/characters/1').flush(makeCharacter());
    fixture.detectChanges();
  });

  it('is off by default, showing the sheet and no editor', () => {
    expect(editor()).toBeNull();
    expect(input('name').value).toBe('Vex');
  });

  it('carries unsaved sheet edits into the JSON document', () => {
    type(input('name'), 'Vax');
    type(input('level'), '9');

    toggleJson();

    expect(currentJson()).toMatchObject({ name: 'Vax', level: 9 });
    http.expectNone({ method: 'PUT' }); // nothing was saved to get here
  });

  it('carries unsaved JSON edits back onto the sheet', () => {
    toggleJson();
    type(editor()!, JSON.stringify({ ...currentJson(), name: 'Percy', level: 11 }));
    toggleJson();

    expect(editor()).toBeNull();
    expect(input('name').value).toBe('Percy');
    expect(input('level').value).toBe('11');
    http.expectNone({ method: 'PUT' });
  });

  it('round-trips repeated toggles without losing either side of the edit', () => {
    type(input('name'), 'Keyleth'); // sheet edit …
    toggleJson();
    type(editor()!, JSON.stringify({ ...currentJson(), strength: 20 })); // … JSON edit …
    toggleJson();
    type(input('level'), '12'); // … sheet edit again
    toggleJson();

    expect(currentJson()).toMatchObject({ name: 'Keyleth', strength: 20, level: 12 });
  });

  it('keeps a bad edit in the editor and explains why', () => {
    toggleJson();
    type(editor()!, '{ definitely not json');
    toggleJson();

    expect(editor()).not.toBeNull(); // stayed in the JSON view
    expect(editor()!.value).toBe('{ definitely not json'); // the text was not discarded
    expect(el().textContent).toContain('Invalid JSON');
  });

  it('saves the edited document straight from the JSON view', () => {
    toggleJson();
    type(editor()!, JSON.stringify({ ...currentJson(), name: 'Grog', strength: 20 }));

    [...el().querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Save')!.click();
    fixture.detectChanges();

    const request = http.expectOne({ method: 'PUT', url: '/api/characters/1' });
    expect(request.request.body).toMatchObject({ name: 'Grog', strength: 20 });
    // Server-owned fields are never echoed back up.
    expect(request.request.body).not.toHaveProperty('derived');
    expect(request.request.body).not.toHaveProperty('id');
  });

  it('refuses to save a document that does not parse', () => {
    toggleJson();
    type(editor()!, '{ broken');

    [...el().querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Save')!.click();
    fixture.detectChanges();

    http.expectNone({ method: 'PUT' });
    expect(el().textContent).toContain('Invalid JSON');
  });

  afterEach(() => http.verify());
});

/** The read-only spells preview: slot dots, per-level sections, and the hover popover. */
describe('CharacterSheet spells preview', () => {
  let fixture: ComponentFixture<CharacterSheet>;
  let http: HttpTestingController;

  const el = (): HTMLElement => fixture.nativeElement;
  const buttonWith = (text: string) =>
    [...el().querySelectorAll('button')].find((b) => b.textContent?.replace(/\s+/g, ' ').trim() === text);
  const slotDots = (level: number) =>
    [...el().querySelectorAll<HTMLButtonElement>('button[aria-label]')].filter((b) =>
      b.getAttribute('aria-label')!.endsWith(`a level ${level} slot`),
    );
  const spellChips = () => [...el().querySelectorAll('li')].map((li) => li.textContent!.trim());

  function click(element: HTMLElement): void {
    element.click();
    fixture.detectChanges();
  }

  function hover(name: string): void {
    const chip = [...el().querySelectorAll('li')].find((li) => li.textContent?.trim() === name)!;
    chip.dispatchEvent(new MouseEvent('mouseenter'));
    fixture.detectChanges();
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [CharacterSheet],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    http = TestBed.inject(HttpTestingController);

    fixture = TestBed.createComponent(CharacterSheet);
    fixture.componentRef.setInput('characterId', 1);
    fixture.componentRef.setInput('campaignId', 2);
    fixture.detectChanges();
    http.expectOne('/api/characters/1').flush(
      makeCharacter({
        spells: [
          makeSpell({ name: 'Mage Hand' }),
          makeSpell({ name: 'Fire Bolt' }),
          makeSpell({
            name: 'Shield',
            level: 1,
            school: 'Abjuration',
            components: 'V, S',
            range: 'Self',
            concentration: false,
            prepared: true,
            description: 'Bonus AC until your next turn.',
          }),
        ],
        spell_slots: [{ level: 1, total: 3, expended: 1 }],
      }),
    );
    fixture.detectChanges();
  });

  it('groups spells by level, showing names only', () => {
    expect(buttonWith('▾ Cantrips (2)')).toBeDefined();
    expect(buttonWith('▾ Level 1 (1)')).toBeDefined();
    expect(spellChips()).toEqual(['Fire Bolt', 'Mage Hand', 'Shield']); // alphabetical per level
  });

  it('collapses one level without touching the others', () => {
    click(buttonWith('▾ Cantrips (2)')!);

    expect(spellChips()).toEqual(['Shield']);
    expect(buttonWith('▸ Cantrips (2)')).toBeDefined();
  });

  it('shows a spell’s full data on hover, and drops it on leave', () => {
    hover('Shield');

    expect(el().textContent).toContain('V, S');
    expect(el().textContent).toContain('Bonus AC until your next turn.');
    expect(el().textContent).toContain('Abjuration');

    const chip = [...el().querySelectorAll('li')].find((li) => li.textContent?.trim() === 'Shield')!;
    chip.dispatchEvent(new MouseEvent('mouseleave'));
    fixture.detectChanges();

    expect(el().textContent).not.toContain('V, S');
  });

  it('expends a slot by clicking an available dot, and saves the new count', () => {
    const dots = slotDots(1);
    expect(dots.map((d) => d.getAttribute('aria-label'))).toEqual([
      'Expend a level 1 slot',
      'Expend a level 1 slot',
      'Restore a level 1 slot',
    ]);

    click(dots[1]); // spend down to the first dot

    expect(el().textContent).toContain('1/3');
    click(buttonWith('Save')!);
    expect(http.expectOne({ method: 'PUT', url: '/api/characters/1' }).request.body.spell_slots).toEqual([
      { level: 1, total: 3, expended: 2 },
    ]);
  });

  it('restores a slot by clicking an expended dot', () => {
    click(slotDots(1)[2]);

    expect(el().textContent).toContain('3/3');
    expect(slotDots(1).every((d) => d.getAttribute('aria-label') === 'Expend a level 1 slot')).toBe(true);
  });

  afterEach(() => {
    http.verify();
    fixture.destroy();
  });
});

/** The read-only features preview: use dots, per-source sections, and the hover popover. */
describe('CharacterSheet features preview', () => {
  let fixture: ComponentFixture<CharacterSheet>;
  let http: HttpTestingController;

  const el = (): HTMLElement => fixture.nativeElement;
  const buttonWith = (text: string) =>
    [...el().querySelectorAll('button')].find((b) => b.textContent?.replace(/\s+/g, ' ').trim() === text);
  const useDots = (name: string) =>
    [...el().querySelectorAll<HTMLButtonElement>('button[aria-label]')].filter((b) =>
      b.getAttribute('aria-label')!.endsWith(`a use of ${name}`),
    );
  const featureChips = () => [...el().querySelectorAll('li')].map((li) => li.textContent!.trim());

  function click(element: HTMLElement): void {
    element.click();
    fixture.detectChanges();
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [CharacterSheet],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    http = TestBed.inject(HttpTestingController);

    fixture = TestBed.createComponent(CharacterSheet);
    fixture.componentRef.setInput('characterId', 1);
    fixture.componentRef.setInput('campaignId', 2);
    fixture.detectChanges();
    http.expectOne('/api/characters/1').flush(
      makeCharacter({
        features: [
          makeFeature({ name: 'Darkvision', source: 'race', description: 'See 60ft in the dark.' }),
          makeFeature({ name: 'Extra Attack', level: 5 }),
          makeFeature({
            name: 'Rage',
            level: 1,
            uses: { max: 3, expended: 1, recharge: 'long' },
          }),
        ],
      }),
    );
    fixture.detectChanges();
  });

  it('groups features by source, ordered by level within a group', () => {
    expect(buttonWith('▾ Class (2)')).toBeDefined();
    expect(buttonWith('▾ Race (1)')).toBeDefined();
    expect(featureChips()).toEqual(['Rage', 'Extra Attack', 'Darkvision']);
  });

  it('collapses one source without touching the others', () => {
    click(buttonWith('▾ Class (2)')!);

    expect(featureChips()).toEqual(['Darkvision']);
    expect(buttonWith('▸ Class (2)')).toBeDefined();
  });

  it('shows a feature’s full details on hover, and drops them on leave', () => {
    const chip = [...el().querySelectorAll('li')].find((li) => li.textContent?.trim() === 'Darkvision')!;
    chip.dispatchEvent(new MouseEvent('mouseenter'));
    fixture.detectChanges();

    expect(el().textContent).toContain('See 60ft in the dark.');

    chip.dispatchEvent(new MouseEvent('mouseleave'));
    fixture.detectChanges();

    expect(el().textContent).not.toContain('See 60ft in the dark.');
  });

  it('tracks limited uses at the top, expending one on click and saving the count', () => {
    const dots = useDots('Rage');
    expect(dots.map((d) => d.getAttribute('aria-label'))).toEqual([
      'Expend a use of Rage',
      'Expend a use of Rage',
      'Restore a use of Rage',
    ]);
    expect(el().textContent).toContain('2/3 · long rest');

    click(dots[0]); // spend everything down to the first dot

    expect(el().textContent).toContain('0/3');
    click(buttonWith('Save')!);
    expect(http.expectOne({ method: 'PUT', url: '/api/characters/1' }).request.body.features).toContainEqual(
      expect.objectContaining({ name: 'Rage', uses: { max: 3, expended: 3, recharge: 'long' } }),
    );
  });

  it('only tracks the limited-use features', () => {
    expect(useDots('Darkvision')).toHaveLength(0);
    expect(useDots('Extra Attack')).toHaveLength(0);
  });

  afterEach(() => {
    http.verify();
    fixture.destroy();
  });
});
