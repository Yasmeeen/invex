import { Component } from '@angular/core';

@Component({
  selector: 'app-vixa-page',
  template: `
    <div class="ptb-3">
      <app-vixa-chat mode="page" [startOpen]="true"></app-vixa-chat>
    </div>
  `,
})
export class VixaPageComponent {}

