import {
  Component,
  computed,
  effect,
  inject,
  input,
  numberAttribute,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { ZardButtonComponent } from '@/components/button/button.component';
import { ZardInputDirective } from '@/components/input/input.directive';
import { CharacterService } from '@/core/api/character.service';
import {
  ABILITIES,
  Character,
  EquipmentItem,
  HitDie,
  OtherProficiency,
  ProficiencyCategory,
  SKILLS,
  Spell,
  SpellSlot,
} from '@/core/api/models';
import { MarkdownView } from '@/shared/markdown-view/markdown-view';
import { EquipmentModal } from './equipment-modal/equipment-modal';
import { SpellsModal } from './spells-modal/spells-modal';

/** A hover tooltip anchored to an equipment chip in the read-only sheet preview. */
interface ItemTooltip {
  item: EquipmentItem;
  top: number;
  left: number;
}

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
  imports: [
    ReactiveFormsModule,
    RouterLink,
    ZardButtonComponent,
    ZardInputDirective,
    EquipmentModal,
    SpellsModal,
    MarkdownView,
  ],
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
  protected readonly equipmentItems = signal<EquipmentItem[]>([]);
  protected readonly spellItems = signal<Spell[]>([]);
  protected readonly spellSlots = signal<SpellSlot[]>([]);
  /** Structured hit-dice pools (edited inline; spent restored by a long rest). */
  protected readonly hitDice = signal<HitDie[]>([]);

  /** Compact spell summary for the read-only sheet: prepared count + total-slot count. */
  protected readonly preparedSpellCount = computed(
    () => this.spellItems().filter((s) => s.prepared || s.always_prepared).length,
  );
  protected readonly totalSlots = computed(() =>
    this.spellSlots().reduce((sum, s) => sum + (s.total || 0), 0),
  );

  /** Read-only equipment preview: whole-section + per-category collapse, and a hover tooltip. */
  protected readonly equipmentCollapsed = signal(false);
  protected readonly equipmentGroupsCollapsed = signal<Set<string>>(new Set());
  protected readonly itemTooltip = signal<ItemTooltip | null>(null);

  /** Equipment grouped by category (custom alphabetically, then Uncategorized) for the preview. */
  protected readonly equipmentGroups = computed(() => {
    const byCat = new Map<string, EquipmentItem[]>();
    for (const item of this.equipmentItems()) {
      (byCat.get(item.category) ?? byCat.set(item.category, []).get(item.category)!).push(item);
    }
    return [...byCat.keys()]
      .sort((a, b) => {
        if (a === '') return 1; // Uncategorized last.
        if (b === '') return -1;
        return a.localeCompare(b);
      })
      .map((category) => ({
        category,
        label: category || 'Uncategorized',
        items: byCat.get(category)!,
      }));
  });

  private readonly equipmentModal = viewChild.required(EquipmentModal);
  private readonly spellsModal = viewChild.required(SpellsModal);

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
    armor_class: [10],
    speed: [30],
    currency: this.fb.nonNullable.group({
      pp: [0],
      gp: [0],
      ep: [0],
      sp: [0],
      cp: [0],
    }),
    features: [''],
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
        this.equipmentItems.set([...c.equipment]);
        this.spellItems.set([...c.spells]);
        this.spellSlots.set([...c.spell_slots]);
        this.hitDice.set([...c.hit_dice]);
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

  protected openEquipment(): void {
    this.equipmentModal().open();
  }

  protected openSpells(): void {
    this.spellsModal().open();
  }

  // --- Hit dice ------------------------------------------------------------

  protected addHitDie(): void {
    this.hitDice.update((list) => [...list, { die: 'd8', total: 1, spent: 0 }]);
  }

  protected removeHitDie(hd: HitDie): void {
    this.hitDice.update((list) => list.filter((h) => h !== hd));
  }

  protected setHitDie(hd: HitDie, field: 'die' | 'total' | 'spent', value: string): void {
    if (field === 'die') {
      hd.die = value;
    } else {
      const n = Math.max(0, Math.floor(Number(value) || 0));
      if (field === 'total') {
        hd.total = n;
        hd.spent = Math.min(hd.spent, n); // can't have spent more than the pool holds
      } else {
        hd.spent = Math.min(n, hd.total);
      }
    }
    this.hitDice.update((list) => [...list]);
  }

  /** Long rest: full HP, drop temp HP, reset expended spell slots, and recover spent hit
   * dice up to half each pool (5E). Local edit — persisted on the next Save. */
  protected longRest(): void {
    this.form.patchValue({ current_hp: this.form.controls.max_hp.value, temp_hp: 0 });
    this.hitDice.update((list) =>
      list.map((h) => ({ ...h, spent: Math.max(0, h.spent - Math.floor(h.total / 2)) })),
    );
    this.spellSlots.update((slots) => slots.map((s) => ({ ...s, expended: 0 })));
  }

  protected toggleEquipmentCollapsed(): void {
    this.equipmentCollapsed.update((v) => !v);
    if (this.equipmentCollapsed()) this.itemTooltip.set(null);
  }

  protected isEquipmentGroupCollapsed(category: string): boolean {
    return this.equipmentGroupsCollapsed().has(category);
  }

  protected toggleEquipmentGroup(category: string): void {
    this.equipmentGroupsCollapsed.update((set) => toggle(set, category));
  }

  /** Show the item's description in a tooltip to the right of the hovered chip. */
  protected showItemDescription(event: MouseEvent, item: EquipmentItem): void {
    if (!item.description?.trim()) return;
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    this.itemTooltip.set({ item, top: rect.top, left: rect.right + 8 });
  }

  protected hideItemDescription(): void {
    this.itemTooltip.set(null);
  }

  protected save(): void {
    this.service
      .update(this.characterId(), {
        ...this.form.getRawValue(),
        saving_throw_proficiencies: [...this.saveProfs()],
        skill_proficiencies: [...this.skillProfs()],
        other_proficiencies: this.otherProfs(),
        equipment: this.equipmentItems(),
        spells: this.spellItems(),
        spell_slots: this.spellSlots(),
        hit_dice: this.hitDice(),
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
