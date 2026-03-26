from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.primitives import padding
from cryptography.hazmat.backends import default_backend
import os

# ── Key loading ───────────────────────────────────────────────────
# Looks for video.key in the same folder as this script.
# This must be the SAME key that encrypt_service.py used on the server.
# Copy it from: docker cp <container>:/app/data/video.key .

KEY_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "video.key")

def load_video_key() -> bytes:
    if not os.path.exists(KEY_FILE):
        raise FileNotFoundError(
            f"video.key not found at: {KEY_FILE}\n"
            f"Copy it from the server: docker cp <container>:/app/data/video.key ."
        )
    with open(KEY_FILE, "rb") as f:
        key = f.read().strip()
    if len(key) == 0:
        raise ValueError("video.key is empty!")
    # Must match encrypt_service.py exactly: key[:32].ljust(32, b'\0')
    return key[:32].ljust(32, b'\0')

try:
    MASTER_KEY = load_video_key()
    print(f"[DECRYPT] ✅ Key loaded from {KEY_FILE} ({len(MASTER_KEY)} bytes)")
except Exception as e:
    print(f"[DECRYPT] ❌ Key load failed: {e}")
    MASTER_KEY = None


# ── Decryption ────────────────────────────────────────────────────
def decrypt_to_bytes(enc_file: str):
    if MASTER_KEY is None:
        print(f"[DECRYPT] No key loaded — cannot decrypt {enc_file}")
        return None

    try:
        with open(enc_file, "rb") as f:
            data = f.read()
    except Exception as e:
        print(f"[DECRYPT] ❌ Cannot read file {enc_file}: {e}")
        return None

    print(f"[DECRYPT] File size: {len(data)} bytes — {enc_file}")

    if len(data) < 32:
        print(f"[DECRYPT] ❌ File too small ({len(data)} bytes), skipping: {enc_file}")
        return None

    iv        = data[:16]       # first 16 bytes = IV
    encrypted = data[16:]       # rest = ciphertext

    try:
        cipher    = Cipher(algorithms.AES(MASTER_KEY), modes.CBC(iv), backend=default_backend())
        decryptor = cipher.decryptor()
        padded    = decryptor.update(encrypted) + decryptor.finalize()
    except Exception as e:
        print(f"[DECRYPT] ❌ AES decryption failed: {e}")
        return None

    try:
        unpadder  = padding.PKCS7(128).unpadder()
        decrypted = unpadder.update(padded) + unpadder.finalize()
        print(f"[DECRYPT] ✅ Decrypted successfully: {len(decrypted)} bytes")
        return decrypted
    except ValueError as e:
        print(
            f"[DECRYPT] ❌ PKCS7 unpad failed — likely WRONG KEY for {enc_file}\n"
            f"           Make sure video.key matches the server key exactly.\n"
            f"           Error: {e}"
        )
        return None
