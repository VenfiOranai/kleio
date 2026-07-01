import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { Campaign } from './models';

@Injectable({ providedIn: 'root' })
export class CampaignService {
  private readonly http = inject(HttpClient);
  private readonly base = '/api/campaigns';

  list(): Observable<Campaign[]> {
    return this.http.get<Campaign[]>(this.base);
  }

  get(id: number): Observable<Campaign> {
    return this.http.get<Campaign>(`${this.base}/${id}`);
  }

  create(data: { name: string; description?: string }): Observable<Campaign> {
    return this.http.post<Campaign>(this.base, data);
  }

  update(id: number, data: Partial<Campaign>): Observable<Campaign> {
    return this.http.put<Campaign>(`${this.base}/${id}`, data);
  }

  delete(id: number): Observable<void> {
    return this.http.delete<void>(`${this.base}/${id}`);
  }
}
