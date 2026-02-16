from datetime import datetime
import random

from sqlalchemy.orm import Session

from .auth import hash_password
from .models import (
    AuditPlan,
    AuditTemplate,
    Department,
    Region,
    ResponseType,
    Site,
    User,
)
from .schemas import (
    AuditPlanCreate,
    AuditPlanUpdate,
    AuditTemplateBase,
    DepartmentBase,
    RegionBase,
    ResponseTypeBase,
    SiteBase,
    UserCreate,
    UserUpdate,
)


def list_users(db: Session, tenant_id: int) -> list[User]:
    return (
        db.query(User)
        .filter(User.tenant_id == tenant_id)
        .order_by(User.created_at.desc())
        .all()
    )


def create_user(db: Session, tenant_id: int, payload: UserCreate) -> User:
    user = User(
        tenant_id=tenant_id,
        email=payload.email.lower(),
        password_hash=hash_password(payload.password),
        first_name=payload.first_name,
        last_name=payload.last_name,
        phone=payload.phone,
        department=payload.department,
        role=payload.role,
        status=payload.status,
        created_at=datetime.utcnow(),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def update_user(db: Session, user: User, payload: UserUpdate) -> User:
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(user, field, value)
    db.commit()
    db.refresh(user)
    return user


def set_last_active(db: Session, user: User) -> User:
    user.last_active = datetime.utcnow()
    db.commit()
    db.refresh(user)
    return user


def reset_password(db: Session, user: User, new_password: str) -> User:
    user.password_hash = hash_password(new_password)
    db.commit()
    db.refresh(user)
    return user


def list_departments(db: Session, tenant_id: int) -> list[Department]:
    return (
        db.query(Department)
        .filter(Department.tenant_id == tenant_id)
        .order_by(Department.created_at.desc())
        .all()
    )


def create_department(db: Session, tenant_id: int, payload: DepartmentBase) -> Department:
    department = Department(
        tenant_id=tenant_id,
        name=payload.name,
        created_at=datetime.utcnow(),
    )
    db.add(department)
    db.commit()
    db.refresh(department)
    return department


def delete_department(db: Session, department: Department) -> None:
    db.delete(department)
    db.commit()


def list_sites(db: Session, tenant_id: int) -> list[Site]:
    return (
        db.query(Site)
        .filter(Site.tenant_id == tenant_id)
        .order_by(Site.created_at.desc())
        .all()
    )


def create_site(db: Session, tenant_id: int, payload: SiteBase) -> Site:
    site = Site(
        tenant_id=tenant_id,
        name=payload.name,
        created_at=datetime.utcnow(),
    )
    db.add(site)
    db.commit()
    db.refresh(site)
    return site


def delete_site(db: Session, site: Site) -> None:
    db.delete(site)
    db.commit()


def list_regions(db: Session, tenant_id: int) -> list[Region]:
    return (
        db.query(Region)
        .filter(Region.tenant_id == tenant_id)
        .order_by(Region.created_at.desc())
        .all()
    )


def create_region(db: Session, tenant_id: int, payload: RegionBase) -> Region:
    region = Region(
        tenant_id=tenant_id,
        name=payload.name,
        created_at=datetime.utcnow(),
    )
    db.add(region)
    db.commit()
    db.refresh(region)
    return region


def delete_region(db: Session, region: Region) -> None:
    db.delete(region)
    db.commit()


def list_response_types(db: Session, tenant_id: int) -> list[ResponseType]:
    return (
        db.query(ResponseType)
        .filter(ResponseType.tenant_id == tenant_id)
        .order_by(ResponseType.created_at.desc())
        .all()
    )


def create_response_type(db: Session, tenant_id: int, payload: ResponseTypeBase) -> ResponseType:
    response_type = ResponseType(
        tenant_id=tenant_id,
        name=payload.name,
        types=payload.types,
        created_at=datetime.utcnow(),
    )
    db.add(response_type)
    db.commit()
    db.refresh(response_type)
    return response_type


def delete_response_type(db: Session, response_type: ResponseType) -> None:
    db.delete(response_type)
    db.commit()


def list_templates(db: Session, tenant_id: int) -> list[AuditTemplate]:
    return (
        db.query(AuditTemplate)
        .filter(AuditTemplate.tenant_id == tenant_id)
        .order_by(AuditTemplate.created_at.desc())
        .all()
    )


def create_template(db: Session, tenant_id: int, payload: AuditTemplateBase) -> AuditTemplate:
    template = AuditTemplate(
        tenant_id=tenant_id,
        name=payload.name,
        note=payload.note,
        tags=payload.tags,
        questions=payload.questions,
        created_at=datetime.utcnow(),
    )
    db.add(template)
    db.commit()
    db.refresh(template)
    return template


def delete_template(db: Session, template: AuditTemplate) -> None:
    db.delete(template)
    db.commit()


def update_template(
    db: Session,
    template: AuditTemplate,
    payload: AuditTemplateBase,
) -> AuditTemplate:
    template.name = payload.name
    template.note = payload.note
    template.tags = payload.tags
    template.questions = payload.questions
    db.commit()
    db.refresh(template)
    return template




def list_audit_plans(db: Session, tenant_id: int) -> list[AuditPlan]:
    return (
        db.query(AuditPlan)
        .filter(AuditPlan.tenant_id == tenant_id)
        .order_by(AuditPlan.created_at.desc())
        .all()
    )


def create_audit_plan(db: Session, tenant_id: int, payload: AuditPlanCreate) -> AuditPlan:
    plan = AuditPlan(
        tenant_id=tenant_id,
        code=generate_audit_code(),
        start_date=payload.start_date,
        end_date=payload.end_date,
        audit_type=payload.audit_type,
        audit_subtype=payload.audit_subtype,
        auditor_name=payload.auditor_name,
        department=payload.department,
        location_city=payload.location_city,
        site=payload.site,
        country=payload.country,
        region=payload.region,
        audit_note=payload.audit_note,
        response_type=payload.response_type,
        asset_scope=payload.asset_scope,
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )
    db.add(plan)
    db.commit()
    db.refresh(plan)
    return plan


def update_audit_plan(db: Session, plan: AuditPlan, payload: AuditPlanUpdate) -> AuditPlan:
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(plan, field, value)
    plan.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(plan)
    return plan


def delete_audit_plan(db: Session, plan: AuditPlan) -> None:
    db.delete(plan)
    db.commit()


def generate_audit_code() -> str:
    alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
    return ''.join(random.choice(alphabet) for _ in range(6))
