import os
from minio import Minio
from minio.error import S3Error

# Load MinIO configuration from environment variables
MINIO_ENDPOINT = os.environ.get("MINIO_ENDPOINT", "192.168.1.100:9000")
# Remove http/https prefix if present, as Minio client expects raw endpoint
if "://" in MINIO_ENDPOINT:
    MINIO_ENDPOINT = MINIO_ENDPOINT.split("://")[1]

MINIO_ACCESS_KEY = os.environ.get("MINIO_ACCESS_KEY", "your_access_key")
MINIO_SECRET_KEY = os.environ.get("MINIO_SECRET_KEY", "your_secret_key")
MINIO_BUCKET = os.environ.get("MINIO_BUCKET", "vms-recordings")

# Initialize MinIO client
try:
    minio_client = Minio(
        MINIO_ENDPOINT,
        access_key=MINIO_ACCESS_KEY,
        secret_key=MINIO_SECRET_KEY,
        secure=False  # Set to True if using HTTPS
    )
    
    # Ensure bucket exists
    if not minio_client.bucket_exists(MINIO_BUCKET):
        minio_client.make_bucket(MINIO_BUCKET)
        print(f"[MINIO] Created bucket '{MINIO_BUCKET}'")
except Exception as e:
    print(f"[MINIO] Initialization failed: {e}")
    minio_client = None


def upload_file(object_name: str, file_path: str) -> bool:
    """Uploads a local file to MinIO."""
    if not minio_client:
        print("[MINIO] Client not initialized. Cannot upload.")
        return False
    try:
        minio_client.fput_object(MINIO_BUCKET, object_name, file_path)
        print(f"[MINIO] ✅ Uploaded {file_path} to {object_name}")
        return True
    except S3Error as e:
        print(f"[MINIO] ❌ Upload failed for {file_path}: {e}")
        return False
    except Exception as e:
        print(f"[MINIO] ❌ Unexpected error uploading {file_path}: {e}")
        return False


def get_file_stream(object_name: str):
    """
    Gets an HTTP stream for an object in MinIO.
    Returns an urllib3.response.HTTPResponse object which can be read in chunks.
    IMPORTANT: You must close the response or consume it fully.
    """
    if not minio_client:
        raise RuntimeError("[MINIO] Client not initialized.")
    try:
        response = minio_client.get_object(MINIO_BUCKET, object_name)
        return response
    except S3Error as e:
        print(f"[MINIO] ❌ Get file stream failed for {object_name}: {e}")
        raise


def list_objects(prefix: str):
    """
    List all objects in MinIO under a specific prefix.
    """
    if not minio_client:
        print("[MINIO] Client not initialized.")
        return []
    try:
        objects = minio_client.list_objects(MINIO_BUCKET, prefix=prefix, recursive=True)
        return [obj.object_name for obj in objects]
    except S3Error as e:
        print(f"[MINIO] ❌ List objects failed for prefix {prefix}: {e}")
        return []


def delete_object(object_name: str) -> bool:
    """Deletes an object from MinIO."""
    if not minio_client:
        print("[MINIO] Client not initialized.")
        return False
    try:
        minio_client.remove_object(MINIO_BUCKET, object_name)
        print(f"[MINIO] 🗑️ Deleted {object_name}")
        return True
    except S3Error as e:
        print(f"[MINIO] ❌ Delete object failed for {object_name}: {e}")
        return False
