from pydantic_settings import BaseSettings
class Settings(BaseSettings):
    MONGO_URI: str = "mongodb://localhost:27017"
    MINIO_ENDPOINT: str = "localhost:9000"
    MINIO_ACCESS_KEY: str = ""
    MINIO_SECRET_KEY: str = ""
    MEDIAMTX_API: str = "http://localhost:9997"
    JWT_SECRET: str = ""
    RECAPTCHA_SECRET_KEY: str = ""
    class Config:
        env_file = ".env"
        extra = "ignore"
settings = Settings()
