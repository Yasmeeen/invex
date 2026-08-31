import { Component, OnDestroy, OnInit } from '@angular/core';
import { NavigationEnd, Router, RouterEvent } from '@angular/router';
import { CurrentUser } from '@core/models/users-interfaces.model';
import { TranslateService } from '@ngx-translate/core';
import { isWarehouse } from '@core/utils/role-utils';
import { StoreSettingsService } from '@shared/services/store-settings.service';
import { OpeningCelebrationService } from '@shared/services/opening-celebration.service';
import { openingCelebrationStorageKey } from '@core/utils/opening-celebration';
import { Branch } from '@core/models/products.model';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-main',
  templateUrl: './main.component.html',
  styleUrls: ['./main.component.scss']
})
export class MainComponent implements OnInit, OnDestroy {

  currentUser:CurrentUser;
  arabicSelected: boolean = false;
  englishSelected: boolean = false;

  /** Narrow sidebar mode — synced from sidebar collapse control */
  sidebarCollapsed = false;
  /** Hide floating Vixa widget on /vixa page (page has its own full chat). */
  showFloatingVixa = true;
  /** Some roles should not see Vixa at all. */
  private hideVixaForRole = false;

  sysSparkAngles = [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330];
  sysStars: { style: Record<string, string> }[] = [];
  sysConfetti: { kind: 'rect' | 'square' | 'strip' | 'star'; style: Record<string, string> }[] = [];
  sysBursts: { left: string; top: string; delay: string; color: string }[] = [];
  showOpeningBanner = false;
  hasActiveOpening = false;
  celebratingBranch: Branch | null = null;
  bannerCopies = [0, 1];
  private celebrationSub?: Subscription;

  constructor(
      private router:Router,
      private translate: TranslateService,
      private storeSettingsService: StoreSettingsService,
      private openingCelebration: OpeningCelebrationService
  ) {
      document.body.classList.add('admin_theme');
  }
  ngOnInit() {
      this.buildSystemCelebration();
      this.celebrationSub = this.openingCelebration.activeBranch$.subscribe((branch) =>
        this.syncOpeningCelebration(branch)
      );
      this.syncOpeningCelebration(this.openingCelebration.snapshot);
      this.openingCelebration.load();
      this.storeSettingsService.load();
    // Hide Vixa for warehouse (and legacy Operation Manager) and cashier.
    try {
      const u: any = JSON.parse(localStorage.getItem('currentUser') || '{}');
      this.hideVixaForRole = isWarehouse(u?.role) || u?.role === 'Cashier';
    } catch {
      this.hideVixaForRole = false;
    }
      this.router.events.subscribe((event: any) => {
          this.navigationInterceptor(event)
      })

  }



  // Shows and hides the loading spinner during RouterEvent changes
  navigationInterceptor(event: RouterEvent): void {
    if (event instanceof NavigationEnd) {
          this.showFloatingVixa =
            !this.hideVixaForRole &&
            !String(event.urlAfterRedirects || event.url || '').startsWith('/vixa');
          document.body.classList.remove('sidebar-active')
          let activeRouterMenus = document.querySelectorAll('.anchor-container');
          for (let i = 0; i < activeRouterMenus.length; i++) {
              activeRouterMenus[i].classList.remove('children-active');
          }
      }
  }

  ngOnDestroy(): void {
    this.celebrationSub?.unsubscribe();
  }

  get celebrationStoreName(): string {
    return (this.storeSettingsService.snapshot?.storeName || '').trim();
  }

  get celebrationBranchName(): string {
    return (this.celebratingBranch?.name || '').trim();
  }

  onSidebarCollapsed(collapsed: boolean): void {
    this.sidebarCollapsed = collapsed;
  }

  dismissOpeningBanner(): void {
    this.showOpeningBanner = false;
    const key = openingCelebrationStorageKey('banner', this.celebratingBranch);
    if (!key) {
      return;
    }
    try {
      sessionStorage.setItem(key, '1');
    } catch {
      /* ignore storage errors */
    }
  }

  private syncOpeningCelebration(branch: Branch | null): void {
    this.celebratingBranch = branch;
    this.hasActiveOpening = !!branch;
    if (!branch) {
      this.showOpeningBanner = false;
      return;
    }
    const key = openingCelebrationStorageKey('banner', branch);
    try {
      this.showOpeningBanner = !key || sessionStorage.getItem(key) !== '1';
    } catch {
      this.showOpeningBanner = true;
    }
  }

  private buildSystemCelebration(): void {
    const colors = ['#6c5ce7', '#f5a623', '#f97316', '#3b82f6', '#fbbf24', '#a78bfa', '#ec4899', '#38bdf8'];

    this.sysStars = Array.from({ length: 8 }, (_, i) => {
      const size = 8 + Math.random() * 10;
      return {
        style: {
          left: `${Math.random() * 100}%`,
          top: `${Math.random() * 100}%`,
          fontSize: `${size}px`,
          color: colors[i % colors.length],
          animationDelay: `${Math.random() * 3}s`,
          animationDuration: `${2.2 + Math.random() * 2.4}s`,
        },
      };
    });

    this.sysConfetti = Array.from({ length: 64 }, (_, i) => {
      const roll = i % 14;
      const kind: 'rect' | 'square' | 'strip' | 'star' =
        roll === 0 ? 'star' : roll % 3 === 1 ? 'square' : roll % 3 === 2 ? 'strip' : 'rect';
      const w =
        kind === 'star'
          ? 9 + Math.random() * 7
          : kind === 'square'
            ? 6 + Math.random() * 6
            : kind === 'strip'
              ? 3 + Math.random() * 3
              : 7 + Math.random() * 9;
      const h =
        kind === 'star' || kind === 'square'
          ? w
          : kind === 'strip'
            ? 11 + Math.random() * 12
            : 4 + Math.random() * 5;
      const color = colors[i % colors.length];
      return {
        kind,
        style: {
          left: `${Math.random() * 100}%`,
          animationDelay: `${Math.random() * 4}s`,
          animationDuration: `${4.2 + Math.random() * 3.2}s`,
          width: `${w}px`,
          height: `${h}px`,
          background: kind === 'star' ? 'transparent' : color,
          color,
          '--tilt': `${Math.floor(Math.random() * 360)}deg`,
          '--drift': `${(Math.random() * 18 - 9).toFixed(1)}vw`,
        },
      };
    });

    this.sysBursts = [
      { left: '8%', top: '18%', delay: '0s', color: '#f5a623' },
      { left: '92%', top: '22%', delay: '0.8s', color: '#ff6b9d' },
      { left: '12%', top: '78%', delay: '1.6s', color: '#b8e88e' },
      { left: '88%', top: '72%', delay: '2.4s', color: '#7dd3fc' },
      { left: '50%', top: '8%', delay: '3.2s', color: '#c084fc' },
      { left: '72%', top: '88%', delay: '4s', color: '#fbbf24' },
    ];
  }
}
