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

  // ===== Draggable floating FAB =====
  fabPos: { left: number; top: number } | null = null;
  private dragging = false;
  private dragStart: { x: number; y: number; left: number; top: number } | null = null;
  private suppressNextToggle = false;
  private readonly dragThresholdPx = 6;

  private subs: Subscription[] = [];

  private get currentRole(): string {
    const u: any = this.auth.getUserFromLocalStorage();
    return String(u?.role || '');
  }

  /** Role-aware quick actions to avoid showing prompts that will 403. */
  get quickActions(): Array<{ labelKey: string; prompt: string }> {
    const r = this.currentRole;
    if (r === 'Warehouse' || r === 'Operation Manager') {
      return [];
    }
    if (r === 'Moderator') {
      return [{ labelKey: 'tr_vixa_quick_bookings_today', prompt: 'tr_vixa_prompt_bookings_today' }];
    }
    if (r === 'Cashier') {
      return [];
    }
    if (r === 'Branch Manager') {
      return [
        { labelKey: 'tr_vixa_quick_sales_today', prompt: 'tr_vixa_prompt_sales_today' },
        { labelKey: 'tr_vixa_quick_bookings_today', prompt: 'tr_vixa_prompt_bookings_today' },
      ];
    }
    // Admin-like: everything (profit allowed on server for Super Admin only; Co Admin gets 403).
    // Keep profit quick action only for Super Admin to match server policy.
    if (r === 'Super Admin') {
      return [
        { labelKey: 'tr_vixa_quick_sales_today', prompt: 'tr_vixa_prompt_sales_today' },
        { labelKey: 'tr_vixa_quick_profit_week', prompt: 'tr_vixa_prompt_profit_week' },
        { labelKey: 'tr_vixa_quick_bookings_today', prompt: 'tr_vixa_prompt_bookings_today' },
      ];
    }
    // Co Admin: no profit.
    if (r === 'Co Admin') {
      return [
        { labelKey: 'tr_vixa_quick_sales_today', prompt: 'tr_vixa_prompt_sales_today' },
        { labelKey: 'tr_vixa_quick_bookings_today', prompt: 'tr_vixa_prompt_bookings_today' },
      ];
    }
    // Default: safe set (no profit).
    return [
      { labelKey: 'tr_vixa_quick_sales_today', prompt: 'tr_vixa_prompt_sales_today' },
      { labelKey: 'tr_vixa_quick_bookings_today', prompt: 'tr_vixa_prompt_bookings_today' },
    ];
  }

  constructor(
    private auth: AuthenticationService,
    private vixa: VixaService,
    private notify: AppNotificationService,
    public translate: TranslateService
  ) {}

  ngOnInit(): void {
    this.restore();
    this.restoreFabPosition();
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

  private fabStorageKey(): string {
    const u: any = this.auth.getUserFromLocalStorage();
    const id = u?._id ? String(u._id) : 'anonymous';
    return `vixa:fab-pos:${id}`;
  }

  private restoreFabPosition(): void {
    if (this.mode !== 'floating') return;
    try {
      const raw = localStorage.getItem(this.fabStorageKey());
      if (!raw) return;
      const p = JSON.parse(raw);
      const left = Number(p?.left);
      const top = Number(p?.top);
      if (!Number.isFinite(left) || !Number.isFinite(top)) return;
      this.fabPos = { left, top };
    } catch {
      // ignore
    }
  }

  private persistFabPosition(): void {
    if (this.mode !== 'floating') return;
    if (!this.fabPos) return;
    try {
      localStorage.setItem(this.fabStorageKey(), JSON.stringify(this.fabPos));
    } catch {
      // ignore
    }
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
    if (this.suppressNextToggle) {
      this.suppressNextToggle = false;
      return;
    }
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
    const r = this.currentRole;
    const canProfit = r === 'Super Admin';
    const canBookings = r === 'Super Admin' || r === 'Co Admin' || r === 'Branch Manager' || r === 'Moderator';
    const canSales = r === 'Super Admin' || r === 'Co Admin' || r === 'Branch Manager';
    const examples = ar
      ? [
          canSales ? '\"مبيعات النهارده\"' : null,
          canBookings ? '\"الحجوزات النهارده\"' : null,
          canProfit ? '\"الربح من 2026-04-01 إلى 2026-04-14\"' : null,
        ]
          .filter(Boolean)
          .join('، ')
      : [
          canSales ? '\"Sales today\"' : null,
          canBookings ? '\"Bookings today\"' : null,
          canProfit ? '\"Profit from 2026-04-01 to 2026-04-14\"' : null,
        ]
          .filter(Boolean)
          .join(', ');
    this.messages = [
      {
        role: 'assistant',
        text: ar
          ? `أهلًا! أنا Vixa — مساعدك الذكي. جرّبي مثلًا: ${examples}.`
          : `Hi! I am Vixa — your smart assistant. Try: ${examples}.`,
        createdAt: Date.now(),
      },
    ];
    this.persist();
  }

  /** Quick actions use i18n keys; translate in TS (pipes are not allowed in `(click)` expressions). */
  sendQuickPrompt(promptKey: string): void {
    const text = String(this.translate.instant(promptKey || '') || '').trim();
    this.input = text;
    this.send();
  }

  get currentUserInitials(): string {
    const u: any = this.auth.getUserFromLocalStorage();
    const name = String(u?.name || u?.email || '').trim();
    if (!name) return 'U';
    const parts = name.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return name.slice(0, 2).toUpperCase();
  }

  get currentUserName(): string {
    const u: any = this.auth.getUserFromLocalStorage();
    return String(u?.name || u?.email || this.translate.instant('tr_users') || 'User').trim();
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.open) this.close();
  }

  @HostListener('document:app-sidebar-open')
  onSidebarOpen(): void {
    if (this.mode === 'floating' && this.open) {
      this.close();
    }
  }

  @HostListener('document:click', ['$event'])
  onDocClick(ev: MouseEvent): void {
    if (!this.open) return;
    if (this.mode === 'page') return;
    const t = ev.target as HTMLElement | null;
    if (!t) return;
    // Don't steal clicks meant for the app menu / drawer.
    if (
      t.closest('.app-topbar__menu-btn') ||
      t.closest('.main-sidebar') ||
      t.closest('.sidebar-background')
    ) {
      return;
    }
    const inside = t.closest('.vixa');
    if (!inside) {
      this.close();
    }
  }

  send(): void {
    const msg = String(this.input || '').trim();
    if (!msg || this.loading) return;
    const userMsg: VixaMessage = {
      role: 'user',
      text: msg,
      createdAt: Date.now(),
    };
    this.messages = [...this.messages, userMsg];
    this.input = '';
    this.persist();

    const u: any = this.auth.getUserFromLocalStorage();
    const userId = u?._id ? String(u._id) : '';
    if (!userId) {
      const warn = this.translate.instant('tr_vixa_no_permission');
      this.notify.push(warn, 'warning');
      const assistant: VixaMessage = {
        role: 'assistant',
        text: String(warn || ''),
        createdAt: Date.now(),
      };
      this.messages = [...this.messages, assistant];
      this.persist();
      return;
    }

    this.loading = true;

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
            // Also show the error inside the chat so the user doesn't feel "nothing happened".
            const assistant: VixaMessage = {
              role: 'assistant',
              text: String(msg2 || ''),
              createdAt: Date.now(),
            };
            this.messages = [...this.messages, assistant];
            this.persist();
          },
        })
    );
  }

  onFabPointerDown(ev: PointerEvent): void {
    if (this.mode !== 'floating') return;
    // Only left click / primary pointer
    if (ev.button != null && ev.button !== 0) return;
    const target = ev.target as HTMLElement | null;
    if (!target) return;

    // Ensure we have an initial position (convert from right/bottom default).
    if (!this.fabPos) {
      const initialLeft = Math.max(0, window.innerWidth - 18 - 100); // 18px margin, 100px default size (mobile)
      const initialTop = Math.max(0, window.innerHeight - 18 - 100);
      this.fabPos = { left: initialLeft, top: initialTop };
    }

    this.dragging = true;
    this.suppressNextToggle = false;
    this.dragStart = {
      x: ev.clientX,
      y: ev.clientY,
      left: this.fabPos.left,
      top: this.fabPos.top,
    };
    try {
      (ev.currentTarget as HTMLElement | null)?.setPointerCapture?.(ev.pointerId);
    } catch {
      // ignore
    }
    ev.preventDefault();
  }

  @HostListener('document:pointermove', ['$event'])
  onDocPointerMove(ev: PointerEvent): void {
    if (!this.dragging || this.mode !== 'floating' || !this.dragStart || !this.fabPos) return;
    const dx = ev.clientX - this.dragStart.x;
    const dy = ev.clientY - this.dragStart.y;

    if (!this.suppressNextToggle && Math.hypot(dx, dy) >= this.dragThresholdPx) {
      this.suppressNextToggle = true;
    }

    const size = window.innerWidth >= 768 ? 72 : 100; // approximate fab size by breakpoint
    const maxLeft = Math.max(0, window.innerWidth - size - 6);
    const maxTop = Math.max(0, window.innerHeight - size - 6);

    const nextLeft = Math.min(maxLeft, Math.max(0, this.dragStart.left + dx));
    const nextTop = Math.min(maxTop, Math.max(0, this.dragStart.top + dy));
    this.fabPos = { left: nextLeft, top: nextTop };
  }

  @HostListener('document:pointerup', ['$event'])
  onDocPointerUp(ev: PointerEvent): void {
    if (!this.dragging || this.mode !== 'floating') return;
    this.dragging = false;
    this.dragStart = null;
    // Persist even if it was just a click (keeps last converted position).
    this.persistFabPosition();
  }
}

