import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { SearchResponse } from './models';

@Injectable({ providedIn: 'root' })
export class SearchService {
  private readonly http = inject(HttpClient);

  search(q: string, campaignId?: number): Observable<SearchResponse> {
    let params = new HttpParams().set('q', q);
    if (campaignId != null) {
      params = params.set('campaign_id', campaignId);
    }
    return this.http.get<SearchResponse>('/api/search', { params });
  }
}
