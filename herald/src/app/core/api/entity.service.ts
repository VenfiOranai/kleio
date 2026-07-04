import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { Entity, EntityGroup } from './models';

@Injectable({ providedIn: 'root' })
export class EntityService {
  private readonly http = inject(HttpClient);

  // --- entities ---
  list(campaignId: number): Observable<Entity[]> {
    return this.http.get<Entity[]>(`/api/campaigns/${campaignId}/entities`);
  }

  /** Create (idempotent — an existing name returns that entity). */
  create(campaignId: number, data: Partial<Entity>): Observable<Entity> {
    return this.http.post<Entity>(`/api/campaigns/${campaignId}/entities`, data);
  }

  update(id: number, data: Partial<Entity>): Observable<Entity> {
    return this.http.put<Entity>(`/api/entities/${id}`, data);
  }

  delete(id: number): Observable<void> {
    return this.http.delete<void>(`/api/entities/${id}`);
  }

  // --- groups ---
  listGroups(campaignId: number): Observable<EntityGroup[]> {
    return this.http.get<EntityGroup[]>(`/api/campaigns/${campaignId}/entity-groups`);
  }

  createGroup(campaignId: number, data: Partial<EntityGroup>): Observable<EntityGroup> {
    return this.http.post<EntityGroup>(`/api/campaigns/${campaignId}/entity-groups`, data);
  }

  updateGroup(id: number, data: Partial<EntityGroup>): Observable<EntityGroup> {
    return this.http.put<EntityGroup>(`/api/entity-groups/${id}`, data);
  }

  deleteGroup(id: number): Observable<void> {
    return this.http.delete<void>(`/api/entity-groups/${id}`);
  }
}
