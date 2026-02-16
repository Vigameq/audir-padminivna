from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    db_host: str
    db_port: int
    db_name: str
    db_user: str
    db_password: str
    db_sslmode: str = 'require'
    db_schema: str = 'public'
    jwt_secret: str
    jwt_algorithm: str = 'HS256'
    access_token_expire_minutes: int = 60
    frontend_origin: str = 'http://localhost:4200'

    class Config:
        env_file = '.env'
        case_sensitive = False


settings = Settings()
