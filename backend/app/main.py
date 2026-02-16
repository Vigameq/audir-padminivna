from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session

from . import crud
from .auth import create_access_token, get_current_user, get_db, verify_password
from .config import settings
from .models import AuditPlan, AuditTemplate, Department, Region, ResponseType, Site, User
from .schemas import (
    AuditPlanCreate,
    AuditPlanOut,
    AuditPlanUpdate,
    AuditTemplateBase,
    AuditTemplateOut,
    DepartmentBase,
    DepartmentOut,
    PasswordReset,
    RegionBase,
    RegionOut,
    ResponseTypeBase,
    ResponseTypeOut,
    SiteBase,
    SiteOut,
    Token,
    UserCreate,
    UserOut,
    UserUpdate,
)

app = FastAPI(title='Audir API')

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_origin],
    allow_credentials=True,
    allow_methods=['*'],
    allow_headers=['*'],
)


@app.post('/auth/login', response_model=Token)
def login(form: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == form.username.lower()).first()
    if not user or not verify_password(form.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail='Invalid login')

    token = create_access_token(str(user.id), user.tenant_id, user.role)
    crud.set_last_active(db, user)
    return Token(access_token=token)


@app.get('/users', response_model=list[UserOut])
def list_users(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return crud.list_users(db, current_user.tenant_id)


@app.post('/users', response_model=UserOut, status_code=status.HTTP_201_CREATED)
def create_user(
    payload: UserCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return crud.create_user(db, current_user.tenant_id, payload)


@app.put('/users/{user_id}', response_model=UserOut)
def update_user(
    user_id: int,
    payload: UserUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    user = (
        db.query(User)
        .filter(User.id == user_id, User.tenant_id == current_user.tenant_id)
        .first()
    )
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='User not found')
    return crud.update_user(db, user, payload)


@app.post('/users/{user_id}/reset-password', response_model=UserOut)
def reset_password(
    user_id: int,
    payload: PasswordReset,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    user = (
        db.query(User)
        .filter(User.id == user_id, User.tenant_id == current_user.tenant_id)
        .first()
    )
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='User not found')
    return crud.reset_password(db, user, payload.new_password)


@app.get('/departments', response_model=list[DepartmentOut])
def list_departments(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return crud.list_departments(db, current_user.tenant_id)


@app.post('/departments', response_model=DepartmentOut, status_code=status.HTTP_201_CREATED)
def create_department(
    payload: DepartmentBase,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return crud.create_department(db, current_user.tenant_id, payload)


@app.delete('/departments/{department_id}', status_code=status.HTTP_204_NO_CONTENT)
def delete_department(
    department_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    department = (
        db.query(Department)
        .filter(Department.id == department_id, Department.tenant_id == current_user.tenant_id)
        .first()
    )
    if not department:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Department not found')
    crud.delete_department(db, department)


@app.get('/sites', response_model=list[SiteOut])
def list_sites(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return crud.list_sites(db, current_user.tenant_id)


@app.post('/sites', response_model=SiteOut, status_code=status.HTTP_201_CREATED)
def create_site(
    payload: SiteBase,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return crud.create_site(db, current_user.tenant_id, payload)


@app.delete('/sites/{site_id}', status_code=status.HTTP_204_NO_CONTENT)
def delete_site(
    site_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    site = (
        db.query(Site)
        .filter(Site.id == site_id, Site.tenant_id == current_user.tenant_id)
        .first()
    )
    if not site:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Site not found')
    crud.delete_site(db, site)


@app.get('/regions', response_model=list[RegionOut])
def list_regions(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return crud.list_regions(db, current_user.tenant_id)


@app.post('/regions', response_model=RegionOut, status_code=status.HTTP_201_CREATED)
def create_region(
    payload: RegionBase,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return crud.create_region(db, current_user.tenant_id, payload)


@app.delete('/regions/{region_id}', status_code=status.HTTP_204_NO_CONTENT)
def delete_region(
    region_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    region = (
        db.query(Region)
        .filter(Region.id == region_id, Region.tenant_id == current_user.tenant_id)
        .first()
    )
    if not region:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Region not found')
    crud.delete_region(db, region)


@app.get('/response-types', response_model=list[ResponseTypeOut])
def list_response_types(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return crud.list_response_types(db, current_user.tenant_id)


@app.post('/response-types', response_model=ResponseTypeOut, status_code=status.HTTP_201_CREATED)
def create_response_type(
    payload: ResponseTypeBase,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return crud.create_response_type(db, current_user.tenant_id, payload)


@app.delete('/response-types/{response_type_id}', status_code=status.HTTP_204_NO_CONTENT)
def delete_response_type(
    response_type_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    response_type = (
        db.query(ResponseType)
        .filter(
            ResponseType.id == response_type_id,
            ResponseType.tenant_id == current_user.tenant_id,
        )
        .first()
    )
    if not response_type:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Response type not found')
    crud.delete_response_type(db, response_type)


@app.get('/templates', response_model=list[AuditTemplateOut])
def list_templates(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return crud.list_templates(db, current_user.tenant_id)


@app.post('/templates', response_model=AuditTemplateOut, status_code=status.HTTP_201_CREATED)
def create_template(
    payload: AuditTemplateBase,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return crud.create_template(db, current_user.tenant_id, payload)


@app.delete('/templates/{template_id}', status_code=status.HTTP_204_NO_CONTENT)
def delete_template(
    template_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    template = (
        db.query(AuditTemplate)
        .filter(
            AuditTemplate.id == template_id,
            AuditTemplate.tenant_id == current_user.tenant_id,
        )
        .first()
    )
    if not template:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Template not found')
    crud.delete_template(db, template)


@app.put('/templates/{template_id}', response_model=AuditTemplateOut)
def update_template(
    template_id: int,
    payload: AuditTemplateBase,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    template = (
        db.query(AuditTemplate)
        .filter(
            AuditTemplate.id == template_id,
            AuditTemplate.tenant_id == current_user.tenant_id,
        )
        .first()
    )
    if not template:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Template not found')
    return crud.update_template(db, template, payload)


@app.get('/audit-plans', response_model=list[AuditPlanOut])
def list_audit_plans(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return crud.list_audit_plans(db, current_user.tenant_id)


@app.post('/audit-plans', response_model=AuditPlanOut, status_code=status.HTTP_201_CREATED)
def create_audit_plan(
    payload: AuditPlanCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return crud.create_audit_plan(db, current_user.tenant_id, payload)


@app.put('/audit-plans/{plan_id}', response_model=AuditPlanOut)
def update_audit_plan(
    plan_id: int,
    payload: AuditPlanUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    plan = (
        db.query(AuditPlan)
        .filter(AuditPlan.id == plan_id, AuditPlan.tenant_id == current_user.tenant_id)
        .first()
    )
    if not plan:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Audit plan not found')
    return crud.update_audit_plan(db, plan, payload)


@app.delete('/audit-plans/{plan_id}', status_code=status.HTTP_204_NO_CONTENT)
def delete_audit_plan(
    plan_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    plan = (
        db.query(AuditPlan)
        .filter(AuditPlan.id == plan_id, AuditPlan.tenant_id == current_user.tenant_id)
        .first()
    )
    if not plan:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Audit plan not found')
    crud.delete_audit_plan(db, plan)
