from datetime import date, datetime

from pydantic import BaseModel, EmailStr, Field


class Token(BaseModel):
    access_token: str
    token_type: str = 'bearer'


class UserBase(BaseModel):
    first_name: str | None = None
    last_name: str | None = None
    email: EmailStr
    phone: str | None = None
    department: str | None = None
    role: str
    status: str


class UserCreate(UserBase):
    password: str = Field(min_length=8)


class UserUpdate(BaseModel):
    first_name: str | None = None
    last_name: str | None = None
    phone: str | None = None
    department: str | None = None
    role: str | None = None
    status: str | None = None


class UserOut(UserBase):
    id: int
    last_active: datetime | None = None
    created_at: datetime

    class Config:
        from_attributes = True


class PasswordReset(BaseModel):
    new_password: str = Field(min_length=8)


class DepartmentBase(BaseModel):
    name: str


class DepartmentOut(DepartmentBase):
    id: int
    created_at: datetime

    class Config:
        from_attributes = True


class SiteBase(BaseModel):
    name: str


class SiteOut(SiteBase):
    id: int
    created_at: datetime

    class Config:
        from_attributes = True


class RegionBase(BaseModel):
    name: str


class RegionOut(RegionBase):
    id: int
    created_at: datetime

    class Config:
        from_attributes = True


class ResponseTypeBase(BaseModel):
    name: str
    types: list[str]


class ResponseTypeOut(ResponseTypeBase):
    id: int
    created_at: datetime

    class Config:
        from_attributes = True


class AuditTemplateBase(BaseModel):
    name: str
    note: str | None = None
    tags: list[str] = []
    questions: list[str] = []


class AuditTemplateOut(AuditTemplateBase):
    id: int
    created_at: datetime

    class Config:
        from_attributes = True


class AuditPlanBase(BaseModel):
    start_date: date
    end_date: date
    audit_type: str
    audit_subtype: str | None = None
    auditor_name: str | None = None
    department: str | None = None
    location_city: str | None = None
    site: str | None = None
    country: str | None = None
    region: str | None = None
    audit_note: str | None = None
    response_type: str | None = None
    asset_scope: list[int] | None = None


class AuditPlanCreate(AuditPlanBase):
    pass


class AuditPlanUpdate(BaseModel):
    start_date: date | None = None
    end_date: date | None = None
    auditor_name: str | None = None
    department: str | None = None
    location_city: str | None = None
    site: str | None = None
    country: str | None = None
    region: str | None = None
    audit_note: str | None = None
    response_type: str | None = None
    asset_scope: list[int] | None = None


class AuditPlanOut(AuditPlanBase):
    id: int
    code: str
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True
