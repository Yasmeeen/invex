import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';
import { io, Socket } from 'socket.io-client';
import { Globals } from '@core/globals';
import { AuthenticationService } from '@core/services/authentication.service';
import { AppNotificationService } from '@shared/services/app-notification.service';
import { TranslateService } from '@ngx-translate/core';
import { NotificationsService, NotificationItem } from './notifications.service';
import { BASE_URL } from '@core/base/urls';

function socketBaseUrl(apiBaseUrl: string): string {
  // apiBaseUrl = http://host:3000/api -> socket server = http://host:3000
  return apiBaseUrl.replace(/\/api\/?$/, '');
}

@Injectable({ providedIn: 'root' })
export class RealtimeNotificationsService {
  private socket: Socket | null = null;
  private connected = false;
  /** Emits newly received notifications for UI to update immediately. */
  readonly newNotification$ = new Subject<NotificationItem>();

  constructor(
    private globals: Globals,
    private auth: AuthenticationService,
    private notify: AppNotificationService,
    private translate: TranslateService,
    private notificationsApi: NotificationsService
  ) {}

  init(): void {
    const user = this.auth.getUserFromLocalStorage();
    const userId = user?._id;
    if (!userId) {
      return;
    }

    // Load unread count at startup
    this.notificationsApi.unreadCount(userId).subscribe({
      next: (r) => (this.globals.unseenNotificationsCount = Number(r?.unreadCount) || 0),
      error: () => {},
    });

    if (this.connected) {
      return;
    }

    const base = socketBaseUrl(BASE_URL);

    this.socket = io(base, {
      transports: ['websocket'],
      auth: { userId },
    });

    this.socket.on('connect', () => {
      this.connected = true;
      this.socket?.emit('join', { userId });
    });

    this.socket.on('disconnect', () => {
      this.connected = false;
    });

    this.socket.on('notification:new', (payload: { notification: NotificationItem }) => {
      const n = payload?.notification;
      if (!n?._id) {
        return;
      }
      this.globals.unseenNotificationsCount = (this.globals.unseenNotificationsCount || 0) + 1;
      const msg = n.body || this.translate.instant('tr_notifications');
      this.notify.push(msg, 'info');
      this.newNotification$.next(n);
    });
  }
}

