import { Component, OnInit } from '@angular/core';
import { Globals } from '@core/globals';

@Component({
    selector: 'system-alerts',
    templateUrl: './system-alerts.component.html',
    styleUrls: ['./system-alerts.component.scss']
})
export class SystemAlertsComponent implements OnInit {

    constructor(
        public globals: Globals
    ) { }

    ngOnInit() {
    }

    reload() {
        //window.location.reload();
        window.location.reload(true);
        this.globals.systemAlerts.newVersion = false;
    }
}
