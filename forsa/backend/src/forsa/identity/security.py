"""Password hashing (stdlib scrypt) and signed session tokens."""

from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
import uuid
from datetime import timedelta

import jwt

from forsa.kernel.clock import utcnow

_N, _R, _P = 2**14, 8, 1


def hash_password(password: str) -> str:
    if len(password) < 10:
        raise ValueError("password must be at least 10 characters")
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=_N, r=_R, p=_P, dklen=32)
    return f"scrypt${_N}${_R}${_P}${base64.b64encode(salt).decode()}${base64.b64encode(digest).decode()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        algo, n, r, p, salt_b64, digest_b64 = stored.split("$")
    except ValueError:
        return False
    if algo != "scrypt":
        return False
    digest = hashlib.scrypt(password.encode(), salt=base64.b64decode(salt_b64), n=int(n), r=int(r), p=int(p), dklen=32)
    return hmac.compare_digest(digest, base64.b64decode(digest_b64))


def issue_token(user_id: uuid.UUID, secret: str, ttl_minutes: int) -> str:
    now = utcnow()
    # Only identity goes in the token; roles are always re-read from the database (spec §38).
    return jwt.encode(
        {"sub": str(user_id), "iat": now, "exp": now + timedelta(minutes=ttl_minutes), "jti": secrets.token_hex(8)},
        secret,
        algorithm="HS256",
    )


def decode_token(token: str, secret: str) -> uuid.UUID | None:
    try:
        claims = jwt.decode(token, secret, algorithms=["HS256"], options={"require": ["exp", "sub"]})
        return uuid.UUID(claims["sub"])
    except (jwt.PyJWTError, ValueError, KeyError):
        return None
