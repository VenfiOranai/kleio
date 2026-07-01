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
}

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
  hit_dice: string;
  armor_class: number;
  speed: number;
  saving_throw_proficiencies: string[];
  skill_proficiencies: string[];
  equipment: string;
  features: string;
  spells: string;
  notes: string;
  created_at: string;
  updated_at: string;
  derived: DerivedStats;
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
