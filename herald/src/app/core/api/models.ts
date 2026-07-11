export interface Campaign {
  id: number;
  name: string;
  description: string;
  created_at: string;
  updated_at: string;
}

export interface Session {
  id: number;
  campaign_id: number;
  title: string;
  session_date: string | null;
  order_index: number;
  raw_notes: string;
  summary: string | null;
  created_at: string;
  updated_at: string;
}

export interface DerivedStats {
  proficiency_bonus: number;
  ability_modifiers: Record<string, number>;
  saving_throws: Record<string, number>;
  skills: Record<string, number>;
  passive_perception: number;
  initiative: number;
  /** Spellcasting ability derived from class ('' for non-casters); spell stats null then. */
  spellcasting_ability: string;
  spell_attack_bonus: number | null;
  spell_save_dc: number | null;
  total_weight: number;
  carrying_capacity: number;
  encumbered: boolean;
  attunement_count: number;
  /** Per-attack to-hit + damage string, in the same order as `attacks`. */
  attacks: AttackDerived[];
}

/** Server-computed to-hit + damage for one attack row (parallel to `attacks` by index). */
export interface AttackDerived {
  name: string;
  to_hit: number;
  damage: string;
}

/** 5E coin purse. */
export interface Currency {
  cp: number;
  sp: number;
  ep: number;
  gp: number;
  pp: number;
}

export type ProficiencyCategory = 'language' | 'weapon' | 'armor' | 'tool' | 'other';

/** A misc proficiency, split by category on the sheet. */
export interface OtherProficiency {
  category: ProficiencyCategory;
  name: string;
}

/** A carried item. `category` is free-form; presets are offered in the UI. */
export interface EquipmentItem {
  name: string;
  quantity: number;
  category: string;
  weight: number | null;
  equipped: boolean;
  attuned: boolean;
  description: string;
}

/** A known/prepared spell. `level` 0 is a cantrip; `school` is free-form. */
export interface Spell {
  name: string;
  level: number;
  school: string;
  prepared: boolean;
  always_prepared: boolean;
  ritual: boolean;
  concentration: boolean;
  casting_time: string;
  range: string;
  components: string;
  duration: string;
  description: string;
}

/** A per-level spell-slot tracker (manual; auto-from-class planned for Phase 14). */
export interface SpellSlot {
  level: number;
  total: number;
  expended: number;
}

/** A pool of hit dice of one size (e.g. `die: "d8"`). `spent` are expended; a long rest
 * restores up to half the pool. Multiclass characters have one entry per die size. */
export interface HitDie {
  die: string;
  total: number;
  spent: number;
}

export type FeatureSource = 'class' | 'subclass' | 'race' | 'background' | 'feat' | 'other';
export type Recharge = 'short' | 'long' | 'other';

/** A limited-use tracker for a feature (e.g. Rage 3/long rest). `recharge` says when
 * `expended` resets; a long rest also restores `short` features. */
export interface FeatureUses {
  max: number;
  expended: number;
  recharge: Recharge;
}

/** A class/racial/background/feat feature or trait. `uses` is null for passive traits;
 * `level` is the character level it was gained at (optional). */
export interface Feature {
  name: string;
  source: FeatureSource;
  level: number | null;
  uses: FeatureUses | null;
  description: string;
}

export type AttackAbility = 'str' | 'dex' | 'spellcasting';
export type AttackSource = 'weapon' | 'spell' | 'manual';

/** An "Attacks & Spellcasting" row. `to_hit` + a damage string are derived server-side
 * (see `DerivedStats.attacks`); `bonus` is a flat to-hit modifier (e.g. a +1 weapon). */
export interface Attack {
  name: string;
  ability: AttackAbility;
  proficient: boolean;
  damage_dice: string;
  damage_type: string;
  bonus: number | null;
  range: string;
  /** Short note shown inline in the attacks table. */
  notes: string;
  /** Longer markdown detail, shown on hover. */
  description: string;
  source: AttackSource;
}

/** Attack abilities offered in the modal. */
export const ATTACK_ABILITIES: AttackAbility[] = ['str', 'dex', 'spellcasting'];

/** Feature sources, offered as buckets in the features modal. */
export const FEATURE_SOURCES: FeatureSource[] = [
  'class',
  'subclass',
  'race',
  'background',
  'feat',
  'other',
];

/** The eight standard 5E schools of magic, offered in the spell form. */
export const SPELL_SCHOOLS = [
  'Abjuration',
  'Conjuration',
  'Divination',
  'Enchantment',
  'Evocation',
  'Illusion',
  'Necromancy',
  'Transmutation',
] as const;

export interface Character {
  id: number;
  campaign_id: number;
  name: string;
  class_name: string;
  subclass: string;
  level: number;
  race: string;
  background: string;
  alignment: string;
  xp: number;
  strength: number;
  dexterity: number;
  constitution: number;
  intelligence: number;
  wisdom: number;
  charisma: number;
  max_hp: number;
  current_hp: number;
  temp_hp: number;
  hit_dice: HitDie[];
  armor_class: number;
  speed: number;
  saving_throw_proficiencies: string[];
  skill_proficiencies: string[];
  currency: Currency;
  other_proficiencies: OtherProficiency[];
  equipment: EquipmentItem[];
  spells: Spell[];
  spell_slots: SpellSlot[];
  features: Feature[];
  attacks: Attack[];
  notes: string;
  created_at: string;
  updated_at: string;
  derived: DerivedStats;
}

export interface SearchResult {
  type: 'session' | 'character';
  id: number;
  campaign_id: number;
  campaign_name: string;
  title: string;
  /** Highlighted snippet (contains <mark> tags) for session hits; null for characters. */
  snippet: string | null;
  rank: number;
}

export interface SearchResponse {
  query: string;
  results: SearchResult[];
}

/** A source session an AI answer drew from. */
export interface Citation {
  session_id: number;
  title: string;
  snippet: string;
}

export interface AskResponse {
  question: string;
  answer: string;
  citations: Citation[];
}

/** A user-defined bucket entities can be organized into, on the Codex page. */
export interface EntityGroup {
  id: number;
  campaign_id: number;
  name: string;
  order_index: number;
  created_at: string;
  updated_at: string;
}

/** An "important word" tagged in notes via @[Name]; referenced by name. */
export interface Entity {
  id: number;
  campaign_id: number;
  name: string;
  group_id: number | null;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export const ABILITIES = [
  'strength',
  'dexterity',
  'constitution',
  'intelligence',
  'wisdom',
  'charisma',
] as const;

/** The 18 standard 5E skills mapped to their governing ability (mirrors the backend). */
export const SKILLS: Record<string, string> = {
  acrobatics: 'dexterity',
  animal_handling: 'wisdom',
  arcana: 'intelligence',
  athletics: 'strength',
  deception: 'charisma',
  history: 'intelligence',
  insight: 'wisdom',
  intimidation: 'charisma',
  investigation: 'intelligence',
  medicine: 'wisdom',
  nature: 'intelligence',
  perception: 'wisdom',
  performance: 'charisma',
  persuasion: 'charisma',
  religion: 'intelligence',
  sleight_of_hand: 'dexterity',
  stealth: 'dexterity',
  survival: 'wisdom',
};
