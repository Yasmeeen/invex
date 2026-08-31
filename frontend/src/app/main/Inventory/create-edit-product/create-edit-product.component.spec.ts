import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatDialogRef } from '@angular/material/dialog';
import { of } from 'rxjs';
import { AppNotificationService } from '@shared/services/app-notification.service';
import { BranchesServce } from '@shared/services/branches.service';
import { ProductsSerivce } from '@shared/services/products.service';
import { TranslateService } from '@ngx-translate/core';
import { AuthenticationService } from '@core/services/authentication.service';

import { CreateEditProductComponent } from './create-edit-product.component';

describe('CreateEditProductComponent', () => {
  let component: CreateEditProductComponent;
  let fixture: ComponentFixture<CreateEditProductComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [CreateEditProductComponent],
      imports: [FormsModule],
      providers: [
        { provide: MatDialogRef, useValue: { close: () => {} } },
        { provide: ProductsSerivce, useValue: { getProducts: () => of({ products: [] }), requestBranchTransfer: () => of({}) } },
        { provide: BranchesServce, useValue: { getBranchs: () => of({ branches: [] }) } },
        { provide: AppNotificationService, useValue: { push: () => {} } },
        { provide: TranslateService, useValue: { instant: (k: string) => k } },
        { provide: AuthenticationService, useValue: { getUserFromLocalStorage: () => ({ _id: 'u1' }) } },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    })
    .compileComponents();
  });

  beforeEach(() => {
    fixture = TestBed.createComponent(CreateEditProductComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
