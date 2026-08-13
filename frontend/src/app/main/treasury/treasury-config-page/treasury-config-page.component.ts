import { Component, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';

export type TreasuryConfigMode = 'treasuries' | 'payment-methods';

@Component({
  selector: 'app-treasury-config-page',
  templateUrl: './treasury-config-page.component.html',
  styleUrls: ['./treasury-config-page.component.scss'],
})
export class TreasuryConfigPageComponent implements OnInit {
  mode: TreasuryConfigMode = 'treasuries';

  constructor(private route: ActivatedRoute) {}

  ngOnInit(): void {
    const m = String(this.route.snapshot.data?.['mode'] || '').trim() as TreasuryConfigMode;
    if (m === 'treasuries' || m === 'payment-methods') {
      this.mode = m;
    }
  }
}
