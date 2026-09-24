"""Object storage port. Content-addressed so identical bytes are stored once."""

from __future__ import annotations

from pathlib import Path
from typing import Protocol

from forsa.kernel.hashing import sha256_bytes


class ObjectStore(Protocol):
    def put(self, content: bytes, prefix: str) -> tuple[str, str]: ...

    def get(self, key: str) -> bytes: ...


class LocalObjectStore:
    """Filesystem adapter for dev/tests. Production: S3-compatible adapter with versioning (runbook)."""

    def __init__(self, root: Path):
        self.root = Path(root)

    def put(self, content: bytes, prefix: str) -> tuple[str, str]:
        digest = sha256_bytes(content)
        key = f"{prefix}/{digest[:2]}/{digest}"
        path = self.root / key
        if not path.exists():
            path.parent.mkdir(parents=True, exist_ok=True)
            tmp = path.with_suffix(".tmp")
            tmp.write_bytes(content)
            tmp.replace(path)
        return key, digest

    def get(self, key: str) -> bytes:
        path = (self.root / key).resolve()
        if not str(path).startswith(str(self.root.resolve())):
            raise ValueError("invalid storage key")
        return path.read_bytes()
