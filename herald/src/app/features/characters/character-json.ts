import { Character, Currency } from '@/core/api/models';

/**
 * The editable slice of a character — exactly what the sheet sends on save. Ids, timestamps
 * and `derived` are server-owned and deliberately excluded, so a draft can be copied between
 * environments (local → dev → prod) and pasted onto a different character.
 */
export type CharacterDraft = Omit<
  Character,
  'id' | 'campaign_id' | 'created_at' | 'updated_at' | 'derived'
>;

const STRING_FIELDS = [
  'name',
  'class_name',
  'subclass',
  'race',
  'background',
  'alignment',
  'notes',
] as const;

const NUMBER_FIELDS = [
  'level',
  'xp',
  'strength',
  'dexterity',
  'constitution',
  'intelligence',
  'wisdom',
  'charisma',
  'max_hp',
  'current_hp',
  'temp_hp',
  'armor_class',
  'speed',
] as const;

const STRING_LIST_FIELDS = ['saving_throw_proficiencies', 'skill_proficiencies'] as const;

const OBJECT_LIST_FIELDS = [
  'hit_dice',
  'other_proficiencies',
  'equipment',
  'spells',
  'spell_slots',
  'features',
  'attacks',
] as const;

const COINS = ['pp', 'gp', 'ep', 'sp', 'cp'] as const;

/** Server-owned keys tolerated (and ignored) so a raw `GET /api/characters/{id}` body pastes
 * cleanly. Any *other* unknown key is reported, to catch typos like `strenght`. */
const IGNORED_KEYS = ['id', 'campaign_id', 'created_at', 'updated_at', 'derived'];

const KNOWN_KEYS = new Set<string>([
  ...STRING_FIELDS,
  ...NUMBER_FIELDS,
  ...STRING_LIST_FIELDS,
  ...OBJECT_LIST_FIELDS,
  'currency',
  ...IGNORED_KEYS,
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Numbers, plus numeric strings (hand-editing the JSON shouldn't punish `"level": "5"`). */
function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/** Serialize a draft to pretty JSON, with keys in sheet order so diffs between two
 * environments line up. */
export function draftToJson(draft: CharacterDraft): string {
  // Built explicitly (rather than spread) so the key order is stable and the compiler flags
  // any field added to `Character` that this editor forgets about.
  const ordered: CharacterDraft = {
    name: draft.name,
    class_name: draft.class_name,
    subclass: draft.subclass,
    level: draft.level,
    race: draft.race,
    background: draft.background,
    alignment: draft.alignment,
    xp: draft.xp,
    strength: draft.strength,
    dexterity: draft.dexterity,
    constitution: draft.constitution,
    intelligence: draft.intelligence,
    wisdom: draft.wisdom,
    charisma: draft.charisma,
    max_hp: draft.max_hp,
    current_hp: draft.current_hp,
    temp_hp: draft.temp_hp,
    hit_dice: draft.hit_dice,
    armor_class: draft.armor_class,
    speed: draft.speed,
    saving_throw_proficiencies: draft.saving_throw_proficiencies,
    skill_proficiencies: draft.skill_proficiencies,
    currency: draft.currency,
    other_proficiencies: draft.other_proficiencies,
    equipment: draft.equipment,
    spells: draft.spells,
    spell_slots: draft.spell_slots,
    features: draft.features,
    attacks: draft.attacks,
    notes: draft.notes,
  };
  return JSON.stringify(ordered, null, 2);
}

/**
 * Parse edited JSON back into a draft, merged over `current`: keys present in the text win,
 * missing keys keep their current value (so a partial paste is a patch, not a wipe).
 *
 * Scalars are type-checked here; the list entries are passed through and validated by the
 * backend on save, which stays the authority on their shape.
 *
 * @throws Error with a human-readable message listing every problem found.
 */
export function parseCharacterDraft(text: string, current: CharacterDraft): CharacterDraft {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new Error(`Invalid JSON — ${(e as Error).message}`);
  }
  if (!isRecord(raw)) {
    throw new Error('Invalid JSON — expected an object describing the character.');
  }

  const errors: string[] = [];
  const draft: CharacterDraft = { ...current };

  for (const key of Object.keys(raw)) {
    if (!KNOWN_KEYS.has(key)) errors.push(`unknown field "${key}"`);
  }

  for (const field of STRING_FIELDS) {
    const value = raw[field];
    if (value === undefined || value === null) continue;
    if (typeof value !== 'string') {
      errors.push(`"${field}" must be a string`);
      continue;
    }
    draft[field] = value;
  }

  for (const field of NUMBER_FIELDS) {
    const value = raw[field];
    if (value === undefined || value === null) continue;
    const n = toNumber(value);
    if (n === null) {
      errors.push(`"${field}" must be a number`);
      continue;
    }
    draft[field] = n;
  }

  if (raw['currency'] !== undefined && raw['currency'] !== null) {
    const value = raw['currency'];
    if (!isRecord(value)) {
      errors.push('"currency" must be an object');
    } else {
      const currency: Currency = { ...current.currency };
      for (const key of Object.keys(value)) {
        if (!(COINS as readonly string[]).includes(key)) {
          errors.push(`unknown coin "currency.${key}"`);
        }
      }
      for (const coin of COINS) {
        const amount = value[coin];
        if (amount === undefined || amount === null) continue;
        const n = toNumber(amount);
        if (n === null) {
          errors.push(`"currency.${coin}" must be a number`);
          continue;
        }
        currency[coin] = n;
      }
      draft.currency = currency;
    }
  }

  for (const field of STRING_LIST_FIELDS) {
    const value = raw[field];
    if (value === undefined || value === null) continue;
    if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
      errors.push(`"${field}" must be an array of strings`);
      continue;
    }
    draft[field] = value as string[];
  }

  // These lists hold different entry types, so assign through an untyped view; the entry
  // shape is the backend's call — it validates (and defaults) on save.
  const lists = draft as Record<string, unknown>;
  for (const field of OBJECT_LIST_FIELDS) {
    const value = raw[field];
    if (value === undefined || value === null) continue;
    if (!Array.isArray(value) || !value.every(isRecord)) {
      errors.push(`"${field}" must be an array of objects`);
      continue;
    }
    lists[field] = value;
  }

  if (errors.length) {
    throw new Error(errors.join('; '));
  }
  return draft;
}
