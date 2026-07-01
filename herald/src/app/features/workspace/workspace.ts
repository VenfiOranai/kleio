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
      this.sessionService.list(id).subscribe((sessions) => {
        this.sessions.set(sessions);
        if (sessions.length && this.selectedSessionId() === null) {
          this.selectedSessionId.set(sessions[0].id);
        }
      });
      this.characterService.list(id).subscribe((characters) => {
        this.characters.set(characters);
        if (characters.length && this.selectedCharacterId() === null) {
          this.selectedCharacterId.set(characters[0].id);
        }
      });
    });
  }

  protected selectSession(value: string): void {
    this.selectedSessionId.set(value ? Number(value) : null);
  }

  protected selectCharacter(value: string): void {
    this.selectedCharacterId.set(value ? Number(value) : null);
  }
}
