from urllib.parse import quote

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from .config import settings


def build_database_url() -> str:
    base_url = (
        f"postgresql+psycopg://{settings.db_user}:{settings.db_password}"
        f"@{settings.db_host}:{settings.db_port}/{settings.db_name}"
        f"?sslmode={settings.db_sslmode}"
    )
    if settings.db_schema:
        options = quote(f"-c search_path={settings.db_schema}")
        return f"{base_url}&options={options}"
    return base_url


engine = create_engine(build_database_url(), pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
