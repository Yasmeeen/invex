import { Component, HostListener } from '@angular/core';
import { Observable, Subscription, fromEvent } from 'rxjs';
import { TranslateService } from '@ngx-translate/core';
import { Globals } from './core/globals';
import { UserSerivce } from '@shared/services/user.service';
import { environment } from 'src/environments/environment';
import { VersionCheckService } from '@shared/services/version-check.service';
import { RealtimeNotificationsService } from '@shared/services/realtime-notifications.service';
import { applyUiLanguage } from './core/i18n/ui-language';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss']
})
export class AppComponent {
    onlineEvent: Observable<Event>;
    offlineEvent: Observable<Event>;
    subscriptions: Subscription[] = [];


    constructor(
        private globals: Globals,
        private versionCheckService: VersionCheckService,
        private translate: TranslateService,
        private realtimeNotifications: RealtimeNotificationsService
    ) {
    }

    ngOnInit() {
      this.translate.setDefaultLang('en');
      applyUiLanguage(this.translate);
      this.realtimeNotifications.init();
        if (environment.env === 'production') {
            this.versionCheckService.initVersionCheck('version.json');
        }
        this.onlineEvent = fromEvent(window, 'online');
        this.offlineEvent = fromEvent(window, 'offline');

        this.subscriptions.push(this.onlineEvent.subscribe(e => {
            this.globals.systemAlerts.noConnection = false;
          }));

          this.subscriptions.push(this.offlineEvent.subscribe(e => {
            this.globals.systemAlerts.noConnection = true;
          }));


    }


    @HostListener("document:click", ["$event"])

    onDocumentClicked(ev:any) {
        if (typeof ev.target.closest !== 'function') {
            return;
        }
        // Anything inside the menu that is not part of its own dropdown counts as
        // the trigger, so taps that land next to the icon still open it.
        let clickedMenu = ev.target.closest('.options-menu');
        if (clickedMenu) {
            let openedDropdown = ev.target.closest('.options-menu-container');
            if (!openedDropdown || !clickedMenu.contains(openedDropdown)) {
                clickedMenu.classList.toggle('active');
                if (clickedMenu.classList.contains('active')) {
                    this.fitMenu(clickedMenu);
                }
            }
        }
        let activeMenus = document.querySelectorAll('.options-menu.active');
        for (let i = 0; i < activeMenus.length; i++) {
            if (
                !(
                    ev.target.closest('.notifications-menu') === activeMenus[i]
                    || (
                        ev.target.closest('.options-menu') === activeMenus[i]
                        && !ev.target.closest('.options-menu-container')
                    )
                    || (ev.target === activeMenus[i])
                    || (ev.target.closest('.options-menu') === activeMenus[i] && ev.target.closest('.prevent'))
                )
                || ev.target.closest('.close-notifications-menu')
                || ev.target.classList.contains('close-notifications-menu')
            ) {
                activeMenus[i].classList.remove('active');
            }
        }
        if (ev.target.closest('.checkbox-with-child .checkbox-arrow')) {
            let checkboxArrow = ev.target.closest('.checkbox-with-child .checkbox-arrow');
            let checkboxParentContainer = checkboxArrow.closest('.checkbox-with-child');
            let children = checkboxParentContainer.querySelectorAll('.checkbox-with-child');
            if (checkboxParentContainer.classList.contains('active')) {
                for (let i = 0; i < children.length; i++) {
                    children[i].classList.remove('active')
                }
            }
            checkboxParentContainer.classList.toggle('active');
            if (checkboxParentContainer.classList.contains('active')) {
            }
        }
        // .
        // .
        // tabs
        if (ev.target.closest('.tabs .navigation-links') && ev.target.classList.contains('single-link') || ev.target.classList.contains('tabs-link') || ev.target.closest('.tabs-link')) {
            ev.preventDefault();
            ev.stopPropagation();
        }
    }
    @HostListener("document:keydown", ["$event"])
    @HostListener('window:resize', ['$event'])
    onResize() {
        let optionsMenuElements = document.querySelectorAll('.options-menu.active');
        for (let i = 0; i < optionsMenuElements.length; i++) {
            this.fitMenu(optionsMenuElements[i]);
        }
    }
    fitMenu(menu:any) {
        let container = menu.querySelector('.options-menu-container');
        if (!container) {
            return;
        }
        menu.classList.remove('reverse-v');
        menu.classList.remove('reverse-h');
        container.style.maxHeight = 'none';
        container.style.overflowY = '';

        const gap = 20;
        const minHeight = 120;
        const triggerRect = menu.getBoundingClientRect();
        const menuHeight = container.offsetHeight;
        const spaceBelow = window.innerHeight - triggerRect.bottom - gap;
        const spaceAbove = triggerRect.top - gap;

        if (menuHeight <= spaceBelow) {
            return;
        }
        if (spaceAbove > spaceBelow) {
            menu.classList.add('reverse-v');
            this.limitMenuHeight(container, Math.max(spaceAbove, minHeight), menuHeight);
        } else {
            this.limitMenuHeight(container, Math.max(spaceBelow, minHeight), menuHeight);
        }
    }

    private limitMenuHeight(container:any, available:number, menuHeight:number) {
        container.style.maxHeight = available + 'px';
        if (menuHeight > available) {
            container.style.overflowY = 'auto';
        }
    }

    ngOnDestroy(): void {
        this.subscriptions.forEach(subscription => subscription.unsubscribe());
    }
  }
