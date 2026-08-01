import {
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  numberAttribute,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { ZardButtonComponent } from '@/components/button/button.component';
import { ZardInputDirective } from '@/components/input/input.directive';
import { CharacterService } from '@/core/api/character.service';
import {
  ABILITIES,
  Attack,
  Character,
  EquipmentItem,
  Feature,
  HitDie,
  OtherProficiency,
  ProficiencyCategory,
  SKILLS,
  Spell,
  SpellSlot,
} from '@/core/api/models';
import { ConfirmDeleteModal } from '@/shared/confirm-delete-modal/confirm-delete-modal';
import { MarkdownView } from '@/shared/markdown-view/markdown-view';
import { AttacksModal } from './attacks-modal/attacks-modal';
import { CharacterDraft, draftToJson, parseCharacterDraft } from './character-json';
import { EquipmentModal } from './equipment-modal/equipment-modal';
import { FeaturesModal } from './features-modal/features-modal';
import { SpellsModal } from './spells-modal/spells-modal';

/** A hover tooltip anchored to an equipment chip in the read-only sheet preview. */
interface ItemTooltip {
  item: EquipmentItem;
  top: number;
  left: number;
}

/** A hover tooltip anchored to a row in the read-only attacks table. */
interface AttackTooltip {
  attack: Attack;
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
    FeaturesModal,
    AttacksModal,
    MarkdownView,
    ConfirmDeleteModal,
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

  /** "View as JSON" mode — edits the whole sheet as one pasteable document, so a character can
   * be moved between environments (copy there, paste here, Save). Off by default; the two
   * views sync on every toggle, in memory, without needing a save in between. */
  protected readonly jsonMode = signal(false);
  protected readonly jsonText = signal('');
  protected readonly jsonError = signal<string | null>(null);

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
  protected readonly featureItems = signal<Feature[]>([]);
  protected readonly attackItems = signal<Attack[]>([]);
  /** Structured hit-dice pools (edited inline; spent restored by a long rest). */
  protected readonly hitDice = signal<HitDie[]>([]);

  /** Attacks zipped with their server-computed to-hit/damage (by index; refresh on save). */
  protected readonly attackRows = computed(() => {
    const derived = this.derived()?.attacks ?? [];
    return this.attackItems().map((attack, i) => ({
      attack,
      toHit: derived[i]?.to_hit ?? null,
      damage: derived[i]?.damage ?? '',
    }));
  });

  /** Compact spell summary for the read-only sheet: prepared count + total-slot count. */
  protected readonly preparedSpellCount = computed(
    () => this.spellItems().filter((s) => s.prepared || s.always_prepared).length,
  );
  protected readonly totalSlots = computed(() =>
    this.spellSlots().reduce((sum, s) => sum + (s.total || 0), 0),
  );

  /** Compact features summary: total count + how many carry a limited-use tracker. */
  protected readonly limitedFeatureCount = computed(
    () => this.featureItems().filter((f) => f.uses).length,
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
  private readonly featuresModal = viewChild.required(FeaturesModal);
  private readonly attacksModal = viewChild.required(AttacksModal);

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
        this.featureItems.set([...c.features]);
        this.attackItems.set([...c.attacks]);
        this.hitDice.set([...c.hit_dice]);
        // A different character was loaded under an open JSON view — show its document.
        if (untracked(this.jsonMode)) {
          this.jsonText.set(draftToJson(c));
          this.jsonError.set(null);
        }
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

  protected openFeatures(): void {
    this.featuresModal().open();
  }

  protected openAttacks(): void {
    this.attacksModal().open();
  }

  /** An attack's Markdown description, shown on hover anchored at the attack's name. */
  protected readonly attackTooltip = signal<AttackTooltip | null>(null);
  private readonly attackTooltipEl = viewChild<ElementRef<HTMLDivElement>>('attackTip');

  protected showAttackDescription(event: MouseEvent, attack: Attack): void {
    if (!attack.description?.trim()) return;
    // Anchor at the name (row's left edge) and open toward the bottom-right; clamp once the
    // tooltip has rendered so its real size keeps it fully on screen.
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    this.attackTooltip.set({ attack, top: rect.bottom + 6, left: rect.left });
    requestAnimationFrame(() => this.clampAttackTooltip());
  }

  private clampAttackTooltip(): void {
    const el = this.attackTooltipEl()?.nativeElement;
    const current = this.attackTooltip();
    if (!el || !current) return;
    const margin = 8;
    const { width, height } = el.getBoundingClientRect();
    const left = Math.max(margin, Math.min(current.left, window.innerWidth - width - margin));
    const top = Math.max(margin, Math.min(current.top, window.innerHeight - height - margin));
    if (left !== current.left || top !== current.top) {
      this.attackTooltip.set({ ...current, top, left });
    }
  }

  protected hideAttackDescription(): void {
    this.attackTooltip.set(null);
  }

  /** Whole-section collapse for the read-only attacks preview. */
  protected readonly attacksCollapsed = signal(false);

  protected toggleAttacksCollapsed(): void {
    this.attacksCollapsed.update((v) => !v);
    if (this.attacksCollapsed()) this.attackTooltip.set(null);
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

  /** Long rest: full HP, drop temp HP, reset expended spell slots, recover spent hit dice up
   * to half each pool (5E), and reset limited-use features that recharge on a short or long
   * rest (a long rest includes a short rest). Local edit — persisted on the next Save. */
  protected longRest(): void {
    this.form.patchValue({ current_hp: this.form.controls.max_hp.value, temp_hp: 0 });
    this.hitDice.update((list) =>
      list.map((h) => ({ ...h, spent: Math.max(0, h.spent - Math.floor(h.total / 2)) })),
    );
    this.spellSlots.update((slots) => slots.map((s) => ({ ...s, expended: 0 })));
    this.featureItems.update((features) =>
      features.map((f) =>
        f.uses && f.uses.recharge !== 'other'
          ? { ...f, uses: { ...f.uses, expended: 0 } }
          : f,
      ),
    );
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

  // --- JSON view -----------------------------------------------------------

  /** Everything the sheet owns, as one plain object — also the payload `save()` sends. */
  private draft(): CharacterDraft {
    return {
      ...this.form.getRawValue(),
      saving_throw_proficiencies: [...this.saveProfs()],
      skill_proficiencies: [...this.skillProfs()],
      other_proficiencies: this.otherProfs(),
      equipment: this.equipmentItems(),
      spells: this.spellItems(),
      spell_slots: this.spellSlots(),
      features: this.featureItems(),
      attacks: this.attackItems(),
      hit_dice: this.hitDice(),
    };
  }

  /** Push a parsed draft back onto the form + section signals (in memory; Save still persists). */
  private applyDraft(draft: CharacterDraft): void {
    this.form.patchValue(draft); // ignores the non-form keys (equipment, spells, …)
    this.saveProfs.set(new Set(draft.saving_throw_proficiencies));
    this.skillProfs.set(new Set(draft.skill_proficiencies));
    this.otherProfs.set([...draft.other_proficiencies]);
    this.equipmentItems.set([...draft.equipment]);
    this.spellItems.set([...draft.spells]);
    this.spellSlots.set([...draft.spell_slots]);
    this.featureItems.set([...draft.features]);
    this.attackItems.set([...draft.attacks]);
    this.hitDice.set([...draft.hit_dice]);
  }

  /** Apply the textarea back onto the sheet. Returns false (leaving `jsonError` set) when the
   * text doesn't parse, so a bad edit is never silently dropped. */
  private commitJson(): boolean {
    try {
      this.applyDraft(parseCharacterDraft(this.jsonText(), this.draft()));
      this.jsonError.set(null);
      return true;
    } catch (e) {
      this.jsonError.set((e as Error).message);
      return false;
    }
  }

  protected toggleJson(): void {
    if (!this.jsonMode()) {
      this.jsonText.set(draftToJson(this.draft()));
      this.jsonError.set(null);
      this.jsonMode.set(true);
    } else if (this.commitJson()) {
      this.jsonMode.set(false);
    }
  }

  protected save(): void {
    // Saving straight from the JSON view applies the text first; a parse error blocks the save.
    if (this.jsonMode() && !this.commitJson()) return;
    this.service.update(this.characterId(), this.draft()).subscribe((c) => {
      this.character.set(c);
      // Re-serialize from the response so the open document shows exactly what was stored
      // (the backend fills defaults for any keys the pasted JSON left out).
      if (this.jsonMode()) this.jsonText.set(draftToJson(c));
      this.saved.set(true);
      setTimeout(() => this.saved.set(false), 2000);
    });
  }

  private readonly confirmDelete = viewChild.required(ConfirmDeleteModal);

  protected promptDelete(): void {
    this.confirmDelete().open();
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
