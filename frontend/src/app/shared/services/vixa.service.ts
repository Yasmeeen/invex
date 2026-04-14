import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { AI_CHAT_URL } from '@core/base/urls';

export type VixaRole =
  | 'Super Admin'
  | 'Co Admin'
  | 'Branch Manager'
  | 'Cashier'
  | 'Warehouse'
  | 'Moderator'
  | string;

export interface VixaChatRequest {
  message: string;
  userId: string;
  /** Optional UI-provided range (YYYY-MM-DD) */
  from?: string;
  to?: string;
  /** Optional branch override for global roles */
  branchId?: string | null;
  uiLang?: string;
}

export interface VixaChatResponse {
  answer: string;
  sources?: Array<{ title?: string; url: string }>;
  meta?: any;
}

@Injectable({ providedIn: 'root' })
export class VixaService {
  constructor(private http: HttpClient) {}

  chat(body: VixaChatRequest): Observable<VixaChatResponse> {
    return this.http.post<VixaChatResponse>(AI_CHAT_URL, body);
  }
}

