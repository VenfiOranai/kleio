import { Component, computed, input, output, signal, viewChild } from '@angular/core';

import { ZardButtonComponent } from '@/components/button/button.component';
import { ZardInputDirective } from '@/components/input/input.directive';
import { FEATURE_SOURCES, Feature, FeatureSource, Recharge } from '@/core/api/models';
import { Modal } from '@/shared/modal/modal';

/** A feature plus a transient client id so `@for` tracking survives in-place edits. */
interface WorkFeature extends Feature {
  _id: number;
}

let nextId = 0;

const RECHARGES: Recharge[] = ['short', 'long', 'other'];

/** Presentation order + labels for the source buckets. */
const SOURCE_LABELS: Record<FeatureSource, string> = {
  class: 'Class',
  subclass: 'Subclass',
  race: 'Race',
  background: 'Background',
  feat: 'Feat',
  other: 'Other',
};

function blankFeature(source: FeatureSource = 'other'): Feature {
  return { name: '', source, level: null, uses: null, description: '' };
}

@Component({
  selector: 'app-features-modal',
  imports: [Modal, ZardButtonComponent, ZardInputDirective],
  templateUrl: './features-modal.html',
})
export class FeaturesModal {
  /** Current features from the sheet; copied into an editable working set when opened. */
  readonly features = input<Feature[]>([]);
  /** Emitted (as a plain-feature list) on every edit so the sheet's summary + save stay live. */
  readonly featuresChange = output<Feature[]>();

  private readonly modal = viewChild.required(Modal);

  protected readonly sources = FEATURE_SOURCES;
  protected readonly recharges = RECHARGES;

  protected readonly working = signal<WorkFeature[]>([]);
  protected readonly search = signal('');
  /** '' = all sources. */
  protected readonly sourceFilter = signal<FeatureSource | ''>('');
  protected readonly limitedOnly = signal(false);

  protected readonly limitedCount = computed(() => this.working().filter((f) => f.uses).length);

  /** Matching features grouped by source, in the canonical source order. */
  protected readonly groups = computed(() => {
    const q = this.search().trim().toLowerCase();
    const sourceFilter = this.sourceFilter();
    const limitedOnly = this.limitedOnly();
    const bySource = new Map<FeatureSource, WorkFeature[]>();
    for (const feature of this.working()) {
      if (q && !feature.name.toLowerCase().includes(q)) continue;
      if (sourceFilter && feature.source !== sourceFilter) continue;
      if (limitedOnly && !feature.uses) continue;
      (bySource.get(feature.source) ?? bySource.set(feature.source, []).get(feature.source)!).push(
        feature,
      );
    }
    return FEATURE_SOURCES.filter((s) => bySource.has(s)).map((source) => ({
      source,
      label: SOURCE_LABELS[source],
      features: bySource.get(source)!.sort((a, b) => a.name.localeCompare(b.name)),
    }));
  });

  open(): void {
    this.working.set(this.features().map((f) => ({ ...f, _id: nextId++ })));
    this.search.set('');
    this.sourceFilter.set('');
    this.limitedOnly.set(false);
    this.modal().open();
  }

  // --- Feature editing -----------------------------------------------------

  protected addFeature(): void {
    const source = this.sourceFilter() || 'other';
    this.working.update((w) => [...w, { ...blankFeature(source), _id: nextId++ }]);
    this.emit();
  }

  protected duplicate(feature: WorkFeature): void {
    this.working.update((w) => {
      const copy = { ...feature, uses: feature.uses ? { ...feature.uses } : null, _id: nextId++ };
      const idx = w.indexOf(feature);
      return [...w.slice(0, idx + 1), copy, ...w.slice(idx + 1)];
    });
    this.emit();
  }

  protected remove(feature: WorkFeature): void {
    this.working.update((w) => w.filter((f) => f !== feature));
    this.emit();
  }

  protected setText(feature: WorkFeature, field: 'name' | 'description', value: string): void {
    feature[field] = value;
    this.working.update((w) => [...w]);
    this.emit();
  }

  protected setSource(feature: WorkFeature, value: string): void {
    feature.source = value as FeatureSource;
    this.working.update((w) => [...w]);
    this.emit();
  }

  protected setLevel(feature: WorkFeature, value: string): void {
    const trimmed = value.trim();
    feature.level = trimmed === '' ? null : Math.max(1, Math.floor(Number(trimmed) || 1));
    this.working.update((w) => [...w]);
    this.emit();
  }

  // --- Limited uses --------------------------------------------------------

  /** Toggle whether a feature is limited-use (adds/removes its `uses` tracker). */
  protected toggleLimited(feature: WorkFeature): void {
    feature.uses = feature.uses ? null : { max: 1, expended: 0, recharge: 'long' };
    this.working.update((w) => [...w]);
    this.emit();
  }

  protected setRecharge(feature: WorkFeature, value: string): void {
    if (feature.uses) feature.uses.recharge = value as Recharge;
    this.working.update((w) => [...w]);
    this.emit();
  }

  private updateUses(feature: WorkFeature, patch: { max?: number; expended?: number }): void {
    if (!feature.uses) return;
    const max = Math.max(0, patch.max ?? feature.uses.max);
    const expended = Math.min(max, Math.max(0, patch.expended ?? feature.uses.expended));
    feature.uses = { ...feature.uses, max, expended };
    this.working.update((w) => [...w]);
    this.emit();
  }

  protected adjustMax(feature: WorkFeature, delta: number): void {
    if (feature.uses) this.updateUses(feature, { max: feature.uses.max + delta });
  }

  protected setMax(feature: WorkFeature, value: string): void {
    this.updateUses(feature, { max: Math.floor(Number(value) || 0) });
  }

  /** `expended` uses as [available] booleans (available-first) for a feature's dot tracker. */
  protected useDots(feature: WorkFeature): boolean[] {
    const uses = feature.uses;
    if (!uses) return [];
    return Array.from({ length: uses.max }, (_, i) => i >= uses.expended);
  }

  /** Clicking a dot: expend down to it if available, otherwise restore up to it. */
  protected toggleDot(feature: WorkFeature, index: number): void {
    const uses = feature.uses;
    if (!uses) return;
    const available = uses.max - uses.expended;
    const expended = index >= available ? index : index + 1;
    this.updateUses(feature, { expended: uses.max - expended });
  }

  /** "Use": expend one use of the feature. */
  protected use(feature: WorkFeature): void {
    if (feature.uses && feature.uses.expended < feature.uses.max) {
      this.updateUses(feature, { expended: feature.uses.expended + 1 });
    }
  }

  protected restore(feature: WorkFeature): void {
    if (feature.uses && feature.uses.expended > 0) {
      this.updateUses(feature, { expended: feature.uses.expended - 1 });
    }
  }

  protected canUse(feature: WorkFeature): boolean {
    return !!feature.uses && feature.uses.expended < feature.uses.max;
  }

  private emit(): void {
    this.featuresChange.emit(this.working().map(({ _id, ...rest }) => rest));
  }
}
