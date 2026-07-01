import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { Character } from './models';

@Injectable({ providedIn: 'root' })
export class CharacterService {
  private readonly http = inject(HttpClient);

  list(campaignId: number): Observable<Character[]> {
    return this.http.get<Character[]>(`/api/campaigns/${campaignId}/characters`);
  }

  create(campaignId: number, data: Partial<Character>): Observable<Character> {
    return this.http.post<Character>(`/api/campaigns/${campaignId}/characters`, data);
  }

  get(id: number): Observable<Character> {
    return this.http.get<Character>(`/api/characters/${id}`);
  }

  update(id: number, data: Partial<Character>): Observable<Character> {
    return this.http.put<Character>(`/api/characters/${id}`, data);
  }

  delete(id: number): Observable<void> {
    return this.http.delete<void>(`/api/characters/${id}`);
  }
}
