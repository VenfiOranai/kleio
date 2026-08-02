import { FEATURE_SOURCES, Feature, FeatureSource, FeatureUses, Recharge } from '@/core/api/models';

import { slotDots, toggleSlotDot } from './spell-slots';

/**
 * Features & traits presentation logic, shared by the sheet's read-only preview and the
 * features modal so both group, order, and track uses identically. Pure — no signals, no DOM.
 */

/** Display labels for the source buckets (ordering comes from `FEATURE_SOURCES`). */
export const SOURCE_LABELS: Record<FeatureSource, string> = {
  class: 'Class',
  subclass: 'Subclass',
  race: 'Race',
  background: 'Background',
  feat: 'Feat',
  other: 'Other',
};

export interface FeatureGroup<T extends Feature> {
  source: FeatureSource;
  label: string;
  features: T[];
}

/** Lowest level first; unleveled features last, ties broken by name. */
function byLevel(a: Feature, b: Feature): number {
  const level = (f: Feature) => f.level ?? Number.MAX_SAFE_INTEGER;
  return level(a) - level(b) || a.name.localeCompare(b.name);
}

/**
 * Features bucketed by source in the canonical source order, each bucket sorted by level.
 * Generic so the modal can group its working copies (which carry a client id) too.
 */
export function groupFeaturesBySource<T extends Feature>(features: readonly T[]): FeatureGroup<T>[] {
  const bySource = new Map<FeatureSource, T[]>();
  for (const feature of features) {
    (bySource.get(feature.source) ?? bySource.set(feature.source, []).get(feature.source)!).push(
      feature,
    );
  }
  // An unrecognised source (e.g. pasted through the JSON view) sorts last rather than
  // dropping the feature off the sheet entirely.
  const rank = (source: FeatureSource) => {
    const index = FEATURE_SOURCES.indexOf(source);
    return index === -1 ? FEATURE_SOURCES.length : index;
  };
  return [...bySource.keys()]
    .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
    .map((source) => ({
      source,
      label: SOURCE_LABELS[source] ?? source,
      features: [...bySource.get(source)!].sort(byLevel),
    }));
}

/** When a limited-use feature's uses come back, in the tracker row's shorthand. */
export function rechargeLabel(recharge: Recharge): string {
  return recharge === 'other' ? 'special' : `${recharge} rest`;
}

/** The same, as a sentence for the hover popover. */
export function rechargePhrase(recharge: Recharge): string {
  return recharge === 'other' ? 'Special recharge' : `Recharges on a ${recharge} rest`;
}

/** A feature's uses as available-first dots — same tracker maths as a spell-slot row. */
export function useDots(uses: FeatureUses): boolean[] {
  return slotDots({ total: uses.max, expended: uses.expended });
}

/** The `expended` count after clicking the dot at `index` (spend down to it / restore up). */
export function toggleUseDot(uses: FeatureUses, index: number): number {
  return toggleSlotDot({ total: uses.max, expended: uses.expended }, index);
}
