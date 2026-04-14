import { Component } from '@angular/core';

@Component({
  selector: 'app-vixa-page',
  template: `
    <div class="p-3">
      <h2 class="mb-3">{{ 'tr_vixa' | translate }}</h2>
      <p class="text-muted mb-4">{{ 'tr_vixa_subtitle' | translate }}</p>
      <p class="text-muted">
        {{ 'tr_vixa_page_hint' | translate }}
      </p>
    </div>
  `,
})
export class VixaPageComponent {}

