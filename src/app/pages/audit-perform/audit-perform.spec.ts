import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AuditPerform } from './audit-perform';

describe('AuditPerform', () => {
  let component: AuditPerform;
  let fixture: ComponentFixture<AuditPerform>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AuditPerform]
    })
    .compileComponents();

    fixture = TestBed.createComponent(AuditPerform);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
