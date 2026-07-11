import {
  Component,
  computed,
  effect,
  inject,
  input,
  numberAttribute,
  output,
  signal,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { ZardButtonComponent } from '@/components/button/button.component';
import { ZardInputDirective } from '@/components/input/input.directive';
import { CharacterService } from '@/core/api/character.service';
import {
  ABILITIES,
  Character,
  OtherProficiency,
  ProficiencyCategory,
  SKILLS,
} from '@/core/api/models';

function toggle(set: Set<string>, key: string): Set<string> {
  const next = new Set(set);
  if (next.has(key)) {
    next.delete(key);
  } else {
    next.add(key);
  }
  return next;
}

@Component({
  selector: 'app-character-sheet',
  imports: [ReactiveFormsModule, RouterLink, ZardButtonComponent, ZardInputDirective],
  templateUrl: './character-sheet.html',
})
export class CharacterSheet {
  private readonly service = inject(CharacterService);
  private readonly fb = inject(FormBuilder);

  // Bound from route params when routed, or passed directly when embedded in the workspace.
  readonly characterId = input.required({ transform: numberAttribute });
  readonly campaignId = input.required({ transform: numberAttribute });
  /** Hide the page chrome (back link) when embedded in the workspace. */
  readonly embedded = input(false);
  /** Emitted (with the deleted id) after the character is removed, so the host can reselect. */
  readonly deleted = output<number>();

  protected readonly character = signal<Character | null>(null);
  protected readonly saved = signal(false);

  protected readonly abilities = ABILITIES;
  protected readonly skills = Object.keys(SKILLS);
  protected readonly skillAbility = SKILLS;
  protected readonly profCategories: ProficiencyCategory[] = [
    'language',
    'weapon',
    'armor',
    'tool',
    'other',
  ];
  protected readonly coins = ['pp', 'gp', 'ep', 'sp', 'cp'] as const;

  protected readonly saveProfs = signal<Set<string>>(new Set());
  protected readonly skillProfs = signal<Set<string>>(new Set());
  protected readonly otherProfs = signal<OtherProficiency[]>([]);

  protected readonly form = this.fb.nonNullable.group({
    name: [''],
    class_name: [''],
    subclass: [''],
    level: [1],
    race: [''],
    background: [''],
    alignment: [''],
    xp: [0],
    strength: [10],
    dexterity: [10],
    constitution: [10],
    intelligence: [10],
    wisdom: [10],
    charisma: [10],
    max_hp: [0],
    current_hp: [0],
    temp_hp: [0],
    hit_dice: [''],
    armor_class: [10],
    speed: [30],
    currency: this.fb.nonNullable.group({
      pp: [0],
      gp: [0],
      ep: [0],
      sp: [0],
      cp: [0],
    }),
    equipment: [''],
    features: [''],
    spells: [''],
    notes: [''],
  });

  /** Derived stats come from the server (source of truth); refreshed after each save. */
  protected readonly derived = computed(() => this.character()?.derived ?? null);

  constructor() {
    // Reload whenever the selected character changes (e.g. switching in the workspace).
    effect(() => {
      const id = this.characterId();
      this.service.get(id).subscribe((c) => {
        this.character.set(c);
        this.form.patchValue(c);
        this.saveProfs.set(new Set(c.saving_throw_proficiencies));
        this.skillProfs.set(new Set(c.skill_proficiencies));
        this.otherProfs.set([...c.other_proficiencies]);
      });
    });
  }

  protected toggleSave(ability: string): void {
    this.saveProfs.update((set) => toggle(set, ability));
  }

  protected toggleSkill(skill: string): void {
    this.skillProfs.update((set) => toggle(set, skill));
  }

  protected profsByCategory(category: ProficiencyCategory): OtherProficiency[] {
    return this.otherProfs().filter((p) => p.category === category);
  }

  protected addProficiency(category: ProficiencyCategory, name: string): void {
    const trimmed = name.trim();
    if (!trimmed) return;
    const exists = this.otherProfs().some(
      (p) => p.category === category && p.name.toLowerCase() === trimmed.toLowerCase(),
    );
    if (exists) return;
    this.otherProfs.update((list) => [...list, { category, name: trimmed }]);
  }

  protected removeProficiency(prof: OtherProficiency): void {
    this.otherProfs.update((list) => list.filter((p) => p !== prof));
  }

  protected save(): void {
    this.service
      .update(this.characterId(), {
        ...this.form.getRawValue(),
        saving_throw_proficiencies: [...this.saveProfs()],
        skill_proficiencies: [...this.skillProfs()],
        other_proficiencies: this.otherProfs(),
      })
      .subscribe((c) => {
        this.character.set(c);
        this.saved.set(true);
        setTimeout(() => this.saved.set(false), 2000);
      });
  }

  protected remove(): void {
    const id = this.characterId();
    this.service.delete(id).subscribe(() => this.deleted.emit(id));
  }

  protected label(key: string): string {
    return key.replace(/_/g, ' ');
  }

  protected fmt(value: number): string {
    return value >= 0 ? `+${value}` : `${value}`;
  }
}
