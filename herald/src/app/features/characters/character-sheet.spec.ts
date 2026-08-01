import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Character } from '@/core/api/models';

import { CharacterSheet } from './character-sheet';

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
