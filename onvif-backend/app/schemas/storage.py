from pydantic import BaseModel

class StoragePathRequest(BaseModel):
    path: str
