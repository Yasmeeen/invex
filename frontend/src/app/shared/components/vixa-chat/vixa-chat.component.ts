import { Component, HostListener, Input, OnDestroy, OnInit } from '@angular/core';
import { Subscription } from 'rxjs';
import { TranslateService } from '@ngx-translate/core';
import { AuthenticationService } from '@core/services/authentication.service';
import { AppNotificationService } from '@shared/services/app-notification.service';
import { VixaService } from '@shared/services/vixa.service';

type VixaMessage = {
  role: 'user' | 'assistant';
  text: string;
  createdAt: number;
  sources?: Array<{ title?: string; url: string }>;
};

@Component({
  selector: 'app-vixa-chat',
  templateUrl: './vixa-chat.component.html',
  styleUrls: ['./vixa-chat.component.scss'],
})
export class VixaChatComponent implements OnInit, OnDestroy {
  /** floating = global widget; page = full-page layout (no FAB) */
  @Input() mode: 'floating' | 'page' = 'floating';
  /** When mode=page, show panel by default. */
  @Input() startOpen = false;

  open = false;
  input = '';
  loading = false;
  messages: VixaMessage[] = [];

  private subs: Subscription[] = [];

  constructor(
    private auth: AuthenticationService,
    private vixa: VixaService,
    private notify: AppNotificationService,
    public translate: TranslateService
  ) {}

  ngOnInit(): void {
    this.restore();
    if (this.mode === 'page' && this.startOpen) {
      this.open = true;
      this.ensureGreeting();
    }
  }

  ngOnDestroy(): void {
    this.subs.forEach((s) => s.unsubscribe());
  }

  private storageKey(): string {
    const u: any = this.auth.getUserFromLocalStorage();
    const id = u?._id ? String(u._id) : 'anonymous';
    return `vixa:chat:${id}`;
  }

  private restore(): void {
    try {
      const raw = sessionStorage.getItem(this.storageKey());
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        this.messages = parsed.slice(-50);
      }
    } catch {
      // ignore
    }
  }

  private persist(): void {
    try {
      sessionStorage.setItem(this.storageKey(), JSON.stringify(this.messages.slice(-50)));
    } catch {
      // ignore
    }
  }

  toggle(): void {
    this.open = !this.open;
    if (this.open) {
      this.ensureGreeting();
    }
  }

  close(): void {
    this.open = false;
  }

  clear(): void {
    this.messages = [];
    this.persist();
  }

  private ensureGreeting(): void {
    if (this.messages?.length) return;
    const ar = String(this.translate.currentLang || this.translate.defaultLang || 'en')
      .toLowerCase()
      .startsWith('ar');
    this.messages = [
      {
        role: 'assistant',
        text: ar
          ? 'Hi! أنا Vixa. اسأليني عن الفواتير/المبيعات النهارده، الحجوزات، أو الأرباح بتاريخ محدد.'
          : 'Hi! I am Vixa. Ask me about invoices/sales today, bookings, or profit for a date range.',
        createdAt: Date.now(),
      },
    ];
    this.persist();
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.open) this.close();
  }

  @HostListener('document:click', ['$event'])
  onDocClick(ev: MouseEvent): void {
    if (!this.open) return;
    if (this.mode === 'page') return;
    const t = ev.target as HTMLElement | null;
    if (!t) return;
    const inside = t.closest('.vixa');
    if (!inside) {
      this.close();
    }
  }

  send(): void {
    const msg = String(this.input || '').trim();
    if (!msg || this.loading) return;
    const u: any = this.auth.getUserFromLocalStorage();
    const userId = u?._id ? String(u._id) : '';
    if (!userId) {
      this.notify.push(this.translate.instant('tr_vixa_no_permission'), 'warning');
      return;
    }

    const userMsg: VixaMessage = {
      role: 'user',
      text: msg,
      createdAt: Date.now(),
    };
    this.messages = [...this.messages, userMsg];
    this.input = '';
    this.loading = true;
    this.persist();

    this.subs.push(
      this.vixa
        .chat({
          message: msg,
          userId,
          uiLang: String(this.translate.currentLang || this.translate.defaultLang || 'en'),
        })
        .subscribe({
          next: (res) => {
            const assistant: VixaMessage = {
              role: 'assistant',
              text: String(res?.answer || ''),
              createdAt: Date.now(),
              sources: Array.isArray(res?.sources) ? res.sources : undefined,
            };
            this.messages = [...this.messages, assistant];
            this.loading = false;
            this.persist();
          },
          error: (err) => {
            this.loading = false;
            const body = err?.error;
            const msg2 =
              body?.error ||
              body?.message ||
              (typeof body === 'string' ? body : null) ||
              this.translate.instant('tr_unexpected_error_message');
            this.notify.push(msg2, 'error');
          },
        })
    );
  }
}

