import { ComponentFixture, TestBed } from '@angular/core/testing';

import { CreateEditVendorComponent } from './create-edit-vendor.component';

describe('CreateEditVendorComponent', () => {
  let component: CreateEditVendorComponent;
  let fixture: ComponentFixture<CreateEditVendorComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [ CreateEditVendorComponent ]
    })
    .compileComponents();
  });

  beforeEach(() => {
    fixture = TestBed.createComponent(CreateEditVendorComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
