import { BreakpointObserver } from '@angular/cdk/layout';
import { Component, computed, effect, inject, input, numberAttribute, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { map } from 'rxjs';

import { ZardButtonComponent } from '@/components/button/button.component';
import { CharacterService } from '@/core/api/character.service';
import { Character, Session } from '@/core/api/models';
import { SessionService } from '@/core/api/session.service';
import { CharacterSheet } from '@/features/characters/character-sheet';
import { SessionEditor } from '@/features/sessions/session-editor';

/** Parse an optional `?session=`/`?character=` query param into an id (or undefined). */
function parseId(value: string | number | undefined): number | undefined {
  const n = numberAttribute(value, NaN);
  return Number.isFinite(n) ? n : undefined;
}

@Component({
  selector: 'app-workspace',
  imports: [RouterLink, ZardButtonComponent, SessionEditor, CharacterSheet],
  templateUrl: './workspace.html',
})
export class Workspace {
  private readonly sessionService = inject(SessionService);
  private readonly characterService = inject(CharacterService);
  private readonly breakpoints = inject(BreakpointObserver);

  readonly campaignId = input.required({ transform: numberAttribute });
  // Deep-link targets from global search: /campaigns/:id?session=… or ?character=…
  readonly session = input(undefined, { transform: parseId });
  readonly character = input(undefined, { transform: parseId });

  protected readonly sessions = signal<Session[]>([]);
  protected readonly characters = signal<Character[]>([]);
  protected readonly selectedSessionId = signal<number | null>(null);
  protected readonly selectedCharacterId = signal<number | null>(null);

  // Desktop: which pane(s) are visible. Mobile: a single active tab (no split).
  protected readonly desktopLayout = signal<'split' | 'notes' | 'character'>('split');
  protected readonly mobileTab = signal<'notes' | 'character'>('notes');

  protected readonly isDesktop = toSignal(
    this.breakpoints.observe('(min-width: 768px)').pipe(map((state) => state.matches)),
    { initialValue: true },
  );

  protected readonly showNotes = computed(() =>
    this.isDesktop() ? this.desktopLayout() !== 'character' : this.mobileTab() === 'notes',
  );
  protected readonly showCharacter = computed(() =>
    this.isDesktop() ? this.desktopLayout() !== 'notes' : this.mobileTab() === 'character',
  );

  constructor() {
    effect(() => {
      const id = this.campaignId();
      const wantSession = this.session();
      const wantCharacter = this.character();

      this.sessionService.list(id).subscribe((sessions) => {
        this.sessions.set(sortSessions(sessions));
        this.selectedSessionId.set(pickSelection(sessions, wantSession, this.selectedSessionId()));
        if (wantSession != null) this.revealNotes();
      });
      this.characterService.list(id).subscribe((characters) => {
        this.characters.set(characters);
        this.selectedCharacterId.set(
          pickSelection(characters, wantCharacter, this.selectedCharacterId()),
        );
        if (wantCharacter != null) this.revealCharacter();
      });
    });
  }

  protected selectSession(value: string): void {
    this.selectedSessionId.set(value ? Number(value) : null);
  }

  protected selectCharacter(value: string): void {
    this.selectedCharacterId.set(value ? Number(value) : null);
  }

  protected createSession(): void {
    // New sessions default to today — notes are almost always written on play day.
    this.sessionService
      .create(this.campaignId(), { title: 'Untitled session', session_date: todayIso() })
      .subscribe((s) => {
        this.sessions.update((list) => sortSessions([...list, s]));
        this.selectedSessionId.set(s.id);
        this.revealNotes();
      });
  }

  /** A save may have changed the title or date, so refresh the entry and re-sort the list. */
  protected onSessionUpdated(updated: Session): void {
    this.sessions.update((list) =>
      sortSessions(list.map((s) => (s.id === updated.id ? updated : s))),
    );
  }

  protected createCharacter(): void {
    this.characterService
      .create(this.campaignId(), { name: 'New character' })
      .subscribe((c) => {
        this.characters.update((list) => [...list, c]);
        this.selectedCharacterId.set(c.id);
        this.revealCharacter();
      });
  }

  protected onSessionDeleted(id: number): void {
    const remaining = this.sessions().filter((s) => s.id !== id);
    this.sessions.set(remaining);
    if (this.selectedSessionId() === id) {
      this.selectedSessionId.set(remaining.length ? remaining[0].id : null);
    }
  }

  protected onCharacterDeleted(id: number): void {
    const remaining = this.characters().filter((c) => c.id !== id);
    this.characters.set(remaining);
    if (this.selectedCharacterId() === id) {
      this.selectedCharacterId.set(remaining.length ? remaining[0].id : null);
    }
  }

  private revealNotes(): void {
    if (this.isDesktop()) {
      if (this.desktopLayout() === 'character') this.desktopLayout.set('split');
    } else {
      this.mobileTab.set('notes');
    }
  }

  private revealCharacter(): void {
    if (this.isDesktop()) {
      if (this.desktopLayout() === 'notes') this.desktopLayout.set('split');
    } else {
      this.mobileTab.set('character');
    }
  }
}

/** Today's date as `YYYY-MM-DD`, in the user's timezone (not UTC, unlike `toISOString()`). */
function todayIso(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * Newest session first, undated ones last — mirrors the ordering the oracle returns, so the
 * dropdown stays correct after a local edit without re-fetching the list.
 * Both dates and timestamps are ISO strings, so lexicographic compare is chronological.
 */
function sortSessions(sessions: Session[]): Session[] {
  return [...sessions].sort((a, b) => {
    if (a.session_date !== b.session_date) {
      if (!a.session_date) return 1;
      if (!b.session_date) return -1;
      return b.session_date.localeCompare(a.session_date);
    }
    return b.created_at.localeCompare(a.created_at);
  });
}

/** Keep a valid selection: honor the deep-link target, else the current one, else the first. */
function pickSelection(
  items: { id: number }[],
  wanted: number | undefined,
  current: number | null,
): number | null {
  if (wanted != null && items.some((i) => i.id === wanted)) return wanted;
  if (current != null && items.some((i) => i.id === current)) return current;
  return items.length ? items[0].id : null;
}
