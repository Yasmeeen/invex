import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';

export type TreasuryConfigMode = 'treasuries' | 'payment-methods' | 'payment-map';

@Component({
  selector: 'app-treasury-config-page',
  templateUrl: './treasury-config-page.component.html',
  styleUrls: ['./treasury-config-page.component.scss'],
})
export class TreasuryConfigPageComponent implements OnInit {
  mode: TreasuryConfigMode = 'treasuries';

  constructor(private route: ActivatedRoute, private router: Router) {}

  ngOnInit(): void {
    const m = String(this.route.snapshot.data?.['mode'] || '').trim() as TreasuryConfigMode;
    if (m === 'treasuries' || m === 'payment-methods' || m === 'payment-map') {
      this.mode = m;
    }
  }

  back(): void {
    this.router.navigate(['/treasury']);
  }
}
