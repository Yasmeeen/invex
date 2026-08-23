import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { Branch } from '@core/models/products.model';
import { pickCelebratingBranch } from '@core/utils/opening-celebration';
import { BranchesServce } from './branches.service';

@Injectable({ providedIn: 'root' })
export class OpeningCelebrationService {
  private readonly activeBranchSub = new BehaviorSubject<Branch | null>(null);
  readonly activeBranch$ = this.activeBranchSub.asObservable();
  private inFlight = false;

  constructor(private branchesService: BranchesServce) {}

  
  get snapshot(): Branch | null {
    return this.activeBranchSub.value;
  }

  load(force = false): void {
    if (this.inFlight && !force) {
      return;
    }
    this.inFlight = true;
    this.branchesService.getBranchs({ page: 1, limit: 1000 }).subscribe({
      next: (response: any) => {
        const list: Branch[] = Array.isArray(response?.branches) ? response.branches : [];
        this.activeBranchSub.next(pickCelebratingBranch(list));
        this.inFlight = false;
      },
      error: () => {
        if (force) {
          this.activeBranchSub.next(null);
        }
        this.inFlight = false;
      },
    });
  }
}
