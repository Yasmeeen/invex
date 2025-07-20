import { Component, HostListener } from '@angular/core';
import { Observable, Subscription, fromEvent } from 'rxjs';
import { TranslateService } from '@ngx-translate/core';
import { Globals } from './core/globals';
import { UserSerivce } from '@shared/services/user.service';
import { environment } from 'src/environments/environment';
import { VersionCheckService } from '@shared/services/version-check.service';

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
        private translate: TranslateService
    ) {
    }

    ngOnInit() {
      this.translate.use('en');
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
        if (ev.target.classList.contains('options-menu')) {
            ev.target.classList.toggle('active');
            if (ev.target.parentNode.classList.contains('active')) {
                this.fitMenu(ev.target);
            }
        }
        if (ev.target.closest('.options-menu')) {
            if (ev.target.parentNode.classList.contains('options-menu')) {
                ev.target.parentNode.classList.toggle('active');
                if (ev.target.parentNode.classList.contains('active')) {
                    this.fitMenu(ev.target.closest('.options-menu'));
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
        menu.classList.remove('reverse-v');
        menu.querySelectorAll('.options-menu-container')[0].style.maxHeight = 'none';
        menu.classList.remove('reverse-h');
        let offsetAndHeight = menu.querySelectorAll('.options-menu-container')[0].offsetHeight + menu.offsetTop;
        let widnowHeight = window.innerHeight
        let outOfWindowVertically = offsetAndHeight - widnowHeight > 0 ? true : false;
        if (outOfWindowVertically) {
            menu.classList.add('reverse-v')
            menu.querySelectorAll('.options-menu-container')[0].style.maxHeight = (menu.offsetTop - 20) + 'px';
        }
    }

    ngOnDestroy(): void {
        this.subscriptions.forEach(subscription => subscription.unsubscribe());
    }
  }
