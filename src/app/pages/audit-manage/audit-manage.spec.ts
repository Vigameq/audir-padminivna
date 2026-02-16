import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AuditManage } from './audit-manage';

describe('AuditManage', () => {
  let component: AuditManage;
  let fixture: ComponentFixture<AuditManage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AuditManage]
    })
    .compileComponents();

    fixture = TestBed.createComponent(AuditManage);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
