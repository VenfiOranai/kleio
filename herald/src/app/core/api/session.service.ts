import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { Session } from './models';

@Injectable({ providedIn: 'root' })
export class SessionService {
  private readonly http = inject(HttpClient);

  list(campaignId: number): Observable<Session[]> {
    return this.http.get<Session[]>(`/api/campaigns/${campaignId}/sessions`);
  }

  create(campaignId: number, data: Partial<Session>): Observable<Session> {
    return this.http.post<Session>(`/api/campaigns/${campaignId}/sessions`, data);
  }

  get(id: number): Observable<Session> {
    return this.http.get<Session>(`/api/sessions/${id}`);
  }

  update(id: number, data: Partial<Session>): Observable<Session> {
    return this.http.put<Session>(`/api/sessions/${id}`, data);
  }

  delete(id: number): Observable<void> {
    return this.http.delete<void>(`/api/sessions/${id}`);
  }
}
