import { describe, expect, it } from 'vitest';

import { CharacterDraft, draftToJson, parseCharacterDraft } from './character-json';

function makeDraft(overrides: Partial<CharacterDraft> = {}): CharacterDraft {
  return {
    name: 'Vex',
    class_name: 'Rogue',
    subclass: 'Assassin',
    level: 5,
    race: 'Half-Elf',
    background: 'Criminal',
    alignment: 'CN',
    xp: 6500,
    strength: 10,
    dexterity: 18,
    constitution: 14,
    intelligence: 12,
    wisdom: 13,
    charisma: 16,
    max_hp: 38,
    current_hp: 38,
    temp_hp: 0,
    hit_dice: [{ die: 'd8', total: 5, spent: 1 }],
    armor_class: 15,
    speed: 30,
    saving_throw_proficiencies: ['dexterity', 'intelligence'],
    skill_proficiencies: ['stealth'],
    currency: { pp: 0, gp: 25, ep: 0, sp: 3, cp: 7 },
    other_proficiencies: [{ category: 'tool', name: "Thieves' Tools" }],
    equipment: [
      {
        name: 'Shortsword',
        quantity: 1,
        category: 'Weapons',
        weight: 2,
        equipped: true,
        attuned: false,
        description: '',
      },
    ],
    spells: [],
    spell_slots: [],
    features: [],
    attacks: [],
    notes: 'Owes a favour to the Clasp.',
    ...overrides,
  };
}

describe('draftToJson', () => {
  it('round-trips a draft unchanged', () => {
    const draft = makeDraft();
    expect(parseCharacterDraft(draftToJson(draft), makeDraft({ name: 'other' }))).toEqual(draft);
  });

  it('omits server-owned fields so the document is portable between environments', () => {
    const parsed = JSON.parse(draftToJson(makeDraft()));
    for (const key of ['id', 'campaign_id', 'created_at', 'updated_at', 'derived']) {
      expect(parsed).not.toHaveProperty(key);
    }
  });

  it('emits keys in sheet order', () => {
    const keys = Object.keys(JSON.parse(draftToJson(makeDraft())));
    expect(keys.slice(0, 4)).toEqual(['name', 'class_name', 'subclass', 'level']);
    expect(keys.at(-1)).toBe('notes');
  });
});

describe('parseCharacterDraft', () => {
  it('applies scalar edits over the current draft', () => {
    const current = makeDraft();
    const result = parseCharacterDraft('{"name": "Vax", "level": 6}', current);
    expect(result.name).toBe('Vax');
    expect(result.level).toBe(6);
    expect(result.class_name).toBe('Rogue'); // untouched keys keep their current value
  });

  it('replaces structured lists wholesale', () => {
    const result = parseCharacterDraft('{"equipment": [], "spell_slots": [{"level": 1}]}', makeDraft());
    expect(result.equipment).toEqual([]);
    expect(result.spell_slots).toEqual([{ level: 1 }]);
  });

  it('merges currency per coin', () => {
    const result = parseCharacterDraft('{"currency": {"gp": 100}}', makeDraft());
    expect(result.currency).toEqual({ pp: 0, gp: 100, ep: 0, sp: 3, cp: 7 });
  });

  it('ignores the server-owned fields of a pasted API response', () => {
    const body = JSON.stringify({
      id: 7,
      campaign_id: 2,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
      derived: { proficiency_bonus: 3 },
      name: 'Percy',
    });
    expect(parseCharacterDraft(body, makeDraft()).name).toBe('Percy');
  });

  it('accepts numeric strings', () => {
    expect(parseCharacterDraft('{"level": "7"}', makeDraft()).level).toBe(7);
  });

  it('rejects malformed JSON', () => {
    expect(() => parseCharacterDraft('{oops', makeDraft())).toThrow(/Invalid JSON/);
  });

  it('rejects a non-object document', () => {
    expect(() => parseCharacterDraft('[1, 2]', makeDraft())).toThrow(/expected an object/);
  });

  it('reports mistyped fields instead of silently dropping them', () => {
    expect(() => parseCharacterDraft('{"name": 5}', makeDraft())).toThrow(/"name" must be a string/);
    expect(() => parseCharacterDraft('{"level": "high"}', makeDraft())).toThrow(
      /"level" must be a number/,
    );
    expect(() => parseCharacterDraft('{"skill_proficiencies": [1]}', makeDraft())).toThrow(
      /array of strings/,
    );
    expect(() => parseCharacterDraft('{"equipment": ["sword"]}', makeDraft())).toThrow(
      /array of objects/,
    );
    expect(() => parseCharacterDraft('{"currency": 5}', makeDraft())).toThrow(
      /"currency" must be an object/,
    );
  });

  it('reports unknown keys so typos surface', () => {
    expect(() => parseCharacterDraft('{"strenght": 12}', makeDraft())).toThrow(
      /unknown field "strenght"/,
    );
    expect(() => parseCharacterDraft('{"currency": {"zp": 1}}', makeDraft())).toThrow(
      /unknown coin "currency.zp"/,
    );
  });

  it('collects every problem in one message', () => {
    expect(() => parseCharacterDraft('{"name": 5, "level": "high"}', makeDraft())).toThrow(
      /"name" must be a string; "level" must be a number/,
    );
  });

  it('treats an explicit null as "leave it alone"', () => {
    expect(parseCharacterDraft('{"name": null}', makeDraft()).name).toBe('Vex');
  });
});
