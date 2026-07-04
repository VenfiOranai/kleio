import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, effect, inject, input, numberAttribute, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { ZardButtonComponent } from '@/components/button/button.component';
import { ZardInputDirective } from '@/components/input/input.directive';
import { EntityService } from '@/core/api/entity.service';
import { Entity, EntityGroup } from '@/core/api/models';

interface GroupedSection {
  group: EntityGroup;
  entities: Entity[];
}

@Component({
  selector: 'app-codex',
  imports: [
    NgTemplateOutlet,
    ReactiveFormsModule,
    RouterLink,
    ZardButtonComponent,
    ZardInputDirective,
  ],
  templateUrl: './codex.html',
})
export class Codex {
  private readonly service = inject(EntityService);
  private readonly fb = inject(FormBuilder);

  readonly campaignId = input.required({ transform: numberAttribute });

  protected readonly entities = signal<Entity[]>([]);
  protected readonly groups = signal<EntityGroup[]>([]);
  /** Expanded sections (group id, or 'ungrouped'). Empty by default → all start collapsed. */
  protected readonly expanded = signal<ReadonlySet<number | 'ungrouped'>>(new Set());

  protected readonly groupForm = this.fb.nonNullable.group({ name: ['', Validators.required] });
  protected readonly entityForm = this.fb.nonNullable.group({ name: ['', Validators.required] });

  /** Entities bucketed by group (in group order), plus the ungrouped remainder. */
  protected readonly sections = computed<GroupedSection[]>(() => {
    const byGroup = this.byGroup();
    return this.groups().map((group) => ({ group, entities: byGroup.get(group.id) ?? [] }));
  });
  protected readonly ungrouped = computed(() => this.byGroup().get(null) ?? []);

  private readonly byGroup = computed(() => {
    const map = new Map<number | null, Entity[]>();
    for (const entity of this.entities()) {
      const key = entity.group_id ?? null;
      const bucket = map.get(key);
      if (bucket) bucket.push(entity);
      else map.set(key, [entity]);
    }
    return map;
  });

  constructor() {
    effect(() => {
      const id = this.campaignId();
      this.service.list(id).subscribe((list) => this.entities.set(list));
      this.service.listGroups(id).subscribe((list) => this.groups.set(list));
    });
  }

  // --- collapse/expand ---
  protected isExpanded(key: number | 'ungrouped'): boolean {
    return this.expanded().has(key);
  }

  protected toggle(key: number | 'ungrouped'): void {
    this.expanded.update((set) => {
      const next = new Set(set);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // --- groups ---
  protected createGroup(): void {
    const name = this.groupForm.controls.name.value.trim();
    if (!name) return;
    this.service.createGroup(this.campaignId(), { name }).subscribe((group) => {
      this.groups.update((list) => [...list, group]);
      this.groupForm.reset({ name: '' });
    });
  }

  protected renameGroup(group: EntityGroup, name: string): void {
    const trimmed = name.trim();
    if (!trimmed || trimmed === group.name) return;
    this.service.updateGroup(group.id, { name: trimmed }).subscribe({
      next: (updated) =>
        this.groups.update((list) => list.map((g) => (g.id === updated.id ? updated : g))),
      error: () => this.reload(), // e.g. name clash — revert to server truth
    });
  }

  protected deleteGroup(group: EntityGroup): void {
    this.service.deleteGroup(group.id).subscribe(() => {
      this.groups.update((list) => list.filter((g) => g.id !== group.id));
      // Members become ungrouped (the server SET NULL); mirror that locally.
      this.entities.update((list) =>
        list.map((e) => (e.group_id === group.id ? { ...e, group_id: null } : e)),
      );
    });
  }

  // --- entities ---
  protected createEntity(): void {
    const name = this.entityForm.controls.name.value.trim();
    if (!name) return;
    this.service.create(this.campaignId(), { name }).subscribe((entity) => {
      this.entities.update((list) =>
        list.some((e) => e.id === entity.id) ? list : [...list, entity],
      );
      this.entityForm.reset({ name: '' });
    });
  }

  protected assignGroup(entity: Entity, value: string): void {
    const groupId = value ? Number(value) : null;
    this.service.update(entity.id, { group_id: groupId }).subscribe((updated) =>
      this.entities.update((list) => list.map((e) => (e.id === updated.id ? updated : e))),
    );
  }

  protected saveDescription(entity: Entity, value: string): void {
    const description = value.trim() || null;
    if (description === (entity.description ?? null)) return;
    this.service.update(entity.id, { description }).subscribe((updated) =>
      this.entities.update((list) => list.map((e) => (e.id === updated.id ? updated : e))),
    );
  }

  protected deleteEntity(entity: Entity): void {
    this.service.delete(entity.id).subscribe(() =>
      this.entities.update((list) => list.filter((e) => e.id !== entity.id)),
    );
  }

  private reload(): void {
    this.service.listGroups(this.campaignId()).subscribe((list) => this.groups.set(list));
    this.service.list(this.campaignId()).subscribe((list) => this.entities.set(list));
  }
}
