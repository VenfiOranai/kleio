import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { AskResponse } from './models';

@Injectable({ providedIn: 'root' })
export class QaService {
  private readonly http = inject(HttpClient);

  /** Ask a question answered from the campaign's session notes (RAG), with citations. */
  ask(campaignId: number, question: string): Observable<AskResponse> {
    return this.http.post<AskResponse>(`/api/campaigns/${campaignId}/ask`, { question });
  }
}
