# Audir Backend

## Setup

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

Update `.env` with your database and JWT settings.
Set `DB_SCHEMA` to isolate AuditX tables (e.g. `auditx`).

## Run

```bash
uvicorn app.main:app --reload --port 8000
```

## Migrations

If your `users` table is missing onboarding fields, run:

```sql
-- backend/migrations/001_add_user_fields.sql
```

Create audit and settings tables with:

```sql
-- backend/migrations/002_create_audit_core.sql
```

## Auth

- `POST /auth/login` (form data: username, password)
- Response: `{ "access_token": "...", "token_type": "bearer" }`

Use the token as:

```
Authorization: Bearer <token>
```
