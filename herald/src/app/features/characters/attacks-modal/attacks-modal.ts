import { Component, computed, input, output, signal, viewChild } from '@angular/core';

import { ZardButtonComponent } from '@/components/button/button.component';
import { ZardInputDirective } from '@/components/input/input.directive';
import {
  ATTACK_ABILITIES,
  Attack,
  AttackAbility,
  EquipmentItem,
  Spell,
} from '@/core/api/models';
import { Modal } from '@/shared/modal/modal';

/** An attack plus a transient client id so `@for` tracking survives in-place edits. */
interface WorkAttack extends Attack {
  _id: number;
}

let nextId = 0;

/** Short labels for the ability `<select>`. */
const ABILITY_LABELS: Record<AttackAbility, string> = {
  str: 'STR',
  dex: 'DEX',
  spellcasting: 'Spell',
};

function blankAttack(): Attack {
  return {
    name: '',
    ability: 'str',
    proficient: true,
    damage_dice: '',
    damage_type: '',
    bonus: null,
    range: '',
    notes: '',
    description: '',
    source: 'manual',
  };
}

@Component({
  selector: 'app-attacks-modal',
  imports: [Modal, ZardButtonComponent, ZardInputDirective],
  templateUrl: './attacks-modal.html',
})
export class AttacksModal {
  /** Current attacks from the sheet; copied into an editable working set when opened. */
  readonly attacks = input<Attack[]>([]);
  /** Equipment + spells feed the "add from weapon/spell" quick-fill. */
  readonly equipment = input<EquipmentItem[]>([]);
  readonly spells = input<Spell[]>([]);
  /** Emitted (as a plain-attack list) on every edit so the sheet's table + save stay live. */
  readonly attacksChange = output<Attack[]>();

  private readonly modal = viewChild.required(Modal);

  protected readonly abilities = ATTACK_ABILITIES;
  protected readonly abilityLabels = ABILITY_LABELS;

  protected readonly working = signal<WorkAttack[]>([]);
  protected readonly search = signal('');

  /** Weapons from equipment (category mentions "weapon") — offered in the add-from menu. */
  protected readonly weapons = computed(() =>
    this.equipment().filter((i) => i.category.toLowerCase().includes('weapon') && i.name.trim()),
  );
  protected readonly namedSpells = computed(() => this.spells().filter((s) => s.name.trim()));

  protected readonly filtered = computed(() => {
    const q = this.search().trim().toLowerCase();
    const list = q
      ? this.working().filter((a) => a.name.toLowerCase().includes(q))
      : this.working();
    return list;
  });

  open(): void {
    this.working.set(this.attacks().map((a) => ({ ...a, _id: nextId++ })));
    this.search.set('');
    this.modal().open();
  }

  // --- Attack editing ------------------------------------------------------

  protected addAttack(): void {
    this.working.update((w) => [...w, { ...blankAttack(), _id: nextId++ }]);
    this.emit();
  }

  /** Quick-fill a new attack from an equipment weapon (STR, proficient, weapon source). */
  protected addFromWeapon(name: string): void {
    if (!name) return;
    this.working.update((w) => [
      ...w,
      { ...blankAttack(), name, source: 'weapon', _id: nextId++ },
    ]);
    this.emit();
  }

  /** Quick-fill a new attack from a spell (spellcasting ability, spell source). */
  protected addFromSpell(name: string): void {
    if (!name) return;
    this.working.update((w) => [
      ...w,
      { ...blankAttack(), name, ability: 'spellcasting', source: 'spell', _id: nextId++ },
    ]);
    this.emit();
  }

  protected duplicate(attack: WorkAttack): void {
    this.working.update((w) => {
      const copy = { ...attack, _id: nextId++ };
      const idx = w.indexOf(attack);
      return [...w.slice(0, idx + 1), copy, ...w.slice(idx + 1)];
    });
    this.emit();
  }

  protected remove(attack: WorkAttack): void {
    this.working.update((w) => w.filter((a) => a !== attack));
    this.emit();
  }

  protected setText(
    attack: WorkAttack,
    field: 'name' | 'damage_dice' | 'damage_type' | 'range' | 'notes' | 'description',
    value: string,
  ): void {
    attack[field] = value;
    this.working.update((w) => [...w]);
    this.emit();
  }

  protected setAbility(attack: WorkAttack, value: string): void {
    attack.ability = value as AttackAbility;
    this.working.update((w) => [...w]);
    this.emit();
  }

  protected setBonus(attack: WorkAttack, value: string): void {
    const trimmed = value.trim();
    attack.bonus = trimmed === '' ? null : Math.floor(Number(trimmed) || 0);
    this.working.update((w) => [...w]);
    this.emit();
  }

  protected toggleProficient(attack: WorkAttack): void {
    attack.proficient = !attack.proficient;
    this.working.update((w) => [...w]);
    this.emit();
  }

  private emit(): void {
    this.attacksChange.emit(this.working().map(({ _id, ...rest }) => rest));
  }
}
