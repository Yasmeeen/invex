import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { NOTIFICATIONS_URL } from '@core/base/urls';

export interface NotificationItem {
  _id: string;
  type: string;
  title?: string;
  body?: string;
  data?: any;
  recipients?: string[];
  readBy?: string[];
  createdAt?: string;
}

export interface NotificationsListResponse {
  notifications: NotificationItem[];
  meta: { totalCount: number; page: number; limit: number };
}

@Injectable({ providedIn: 'root' })
export class NotificationsService {
  constructor(private http: HttpClient) {}

  list(userId: string, page = 1, limit = 20): Observable<NotificationsListResponse> {
    return this.http.get<NotificationsListResponse>(NOTIFICATIONS_URL, {
      params: { userId, page: String(page), limit: String(limit) },
    });
  }

  unreadCount(userId: string): Observable<{ unreadCount: number }> {
    return this.http.get<{ unreadCount: number }>(`${NOTIFICATIONS_URL}/unread-count`, {
      params: { userId },
    });
  }

  markRead(notificationId: string, userId: string): Observable<unknown> {
    return this.http.patch(`${NOTIFICATIONS_URL}/${notificationId}/read`, { userId });
  }

  markAllRead(userId: string): Observable<unknown> {
    return this.http.patch(`${NOTIFICATIONS_URL}/read-all`, { userId });
  }
}

