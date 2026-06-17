import os
from cryptography.hazmat.primitives.asymmetric import rsa, padding
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.backends import default_backend

# Storage paths
KEYS_DIR = os.environ.get("KEYS_DIR", "/app/data")
PRIVATE_KEY_PATH = os.path.join(KEYS_DIR, "private_key.pem")
PUBLIC_KEY_PATH = os.path.join(KEYS_DIR, "public_key.pem")

_private_key = None
_public_key = None

def _generate_and_save_keys():
    """Generates a new RSA key pair and saves them to disk."""
    print("[SIGNATURE] Generating new RSA key pair for digital signatures...")
    os.makedirs(KEYS_DIR, exist_ok=True)
    
    private_key = rsa.generate_private_key(
        public_exponent=65537,
        key_size=2048,
        backend=default_backend()
    )
    
    public_key = private_key.public_key()
    
    with open(PRIVATE_KEY_PATH, "wb") as f:
        f.write(private_key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=serialization.NoEncryption()
        ))
        
    with open(PUBLIC_KEY_PATH, "wb") as f:
        f.write(public_key.public_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PublicFormat.SubjectPublicKeyInfo
        ))
    
    print(f"[SIGNATURE] Keys saved to {KEYS_DIR}")
    return private_key, public_key

def _load_keys():
    """Loads RSA keys from disk, generating them if they don't exist."""
    global _private_key, _public_key
    
    if _private_key and _public_key:
        return _private_key, _public_key
        
    if not os.path.exists(PRIVATE_KEY_PATH) or not os.path.exists(PUBLIC_KEY_PATH):
        _private_key, _public_key = _generate_and_save_keys()
    else:
        try:
            with open(PRIVATE_KEY_PATH, "rb") as f:
                _private_key = serialization.load_pem_private_key(
                    f.read(),
                    password=None,
                    backend=default_backend()
                )
            with open(PUBLIC_KEY_PATH, "rb") as f:
                _public_key = serialization.load_pem_public_key(
                    f.read(),
                    backend=default_backend()
                )
            print("[SIGNATURE] RSA keys loaded successfully.")
        except Exception as e:
            print(f"[SIGNATURE] Error loading keys: {e}. Generating new keys...")
            _private_key, _public_key = _generate_and_save_keys()
            
    return _private_key, _public_key

def get_public_key_pem() -> bytes:
    """Returns the public key in PEM format as bytes."""
    _, pub_key = _load_keys()
    return pub_key.public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo
    )

def sign_data(data: bytes) -> bytes:
    """Computes SHA-256 hash of data and signs it with the private key."""
    priv_key, _ = _load_keys()
    signature = priv_key.sign(
        data,
        padding.PSS(
            mgf=padding.MGF1(hashes.SHA256()),
            salt_length=padding.PSS.MAX_LENGTH
        ),
        hashes.SHA256()
    )
    return signature

def verify_signature(data: bytes, signature: bytes) -> bool:
    """Verifies that the data matches the signature using the public key."""
    _, pub_key = _load_keys()
    try:
        pub_key.verify(
            signature,
            data,
            padding.PSS(
                mgf=padding.MGF1(hashes.SHA256()),
                salt_length=padding.PSS.MAX_LENGTH
            ),
            hashes.SHA256()
        )
        return True
    except InvalidSignature:
        return False
    except Exception as e:
        print(f"[SIGNATURE] Verification error: {e}")
        return False

# Initialize on import
_load_keys()
