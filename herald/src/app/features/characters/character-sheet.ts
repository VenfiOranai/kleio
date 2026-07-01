import { Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import { ZardButtonComponent } from '@/components/button/button.component';
import { ZardInputDirective } from '@/components/input/input.directive';
import { CharacterService } from '@/core/api/character.service';
import { ABILITIES, Character, SKILLS } from '@/core/api/models';

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
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly service = inject(CharacterService);
  private readonly fb = inject(FormBuilder);

  private readonly characterId = Number(this.route.snapshot.paramMap.get('characterId'));
  protected readonly campaignId = Number(this.route.snapshot.paramMap.get('campaignId'));
  protected readonly character = signal<Character | null>(null);
  protected readonly saved = signal(false);

  protected readonly abilities = ABILITIES;
  protected readonly skills = Object.keys(SKILLS);
  protected readonly skillAbility = SKILLS;

  protected readonly saveProfs = signal<Set<string>>(new Set());
  protected readonly skillProfs = signal<Set<string>>(new Set());

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
    equipment: [''],
    features: [''],
    spells: [''],
    notes: [''],
  });

  /** Derived stats come from the server (source of truth); refreshed after each save. */
  protected readonly derived = computed(() => this.character()?.derived ?? null);

  constructor() {
    this.service.get(this.characterId).subscribe((c) => {
      this.character.set(c);
      this.form.patchValue(c);
      this.saveProfs.set(new Set(c.saving_throw_proficiencies));
      this.skillProfs.set(new Set(c.skill_proficiencies));
    });
  }

  protected toggleSave(ability: string): void {
    this.saveProfs.update((set) => toggle(set, ability));
  }

  protected toggleSkill(skill: string): void {
    this.skillProfs.update((set) => toggle(set, skill));
  }

  protected save(): void {
    this.service
      .update(this.characterId, {
        ...this.form.getRawValue(),
        saving_throw_proficiencies: [...this.saveProfs()],
        skill_proficiencies: [...this.skillProfs()],
      })
      .subscribe((c) => {
        this.character.set(c);
        this.saved.set(true);
        setTimeout(() => this.saved.set(false), 2000);
      });
  }

  protected remove(): void {
    this.service
      .delete(this.characterId)
      .subscribe(() => this.router.navigate(['/campaigns', this.campaignId]));
  }

  protected label(key: string): string {
    return key.replace(/_/g, ' ');
  }

  protected fmt(value: number): string {
    return value >= 0 ? `+${value}` : `${value}`;
  }
}
