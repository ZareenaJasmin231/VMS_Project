import jwt

SECRET = "MIRADOR_SECRET_KEY"

def validate_license(token):
    try:
        data = jwt.decode(token, SECRET, algorithms=["HS256"])
        return True, data
    except Exception as e:
        print("License error:", e)
        return False, {}