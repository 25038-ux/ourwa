"""Country packs (spec §119): Mauritania is the first implementation, not a hard-coded assumption."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml

_DIR = Path(__file__).parent / "packs"


@lru_cache(maxsize=16)
def get_pack(code: str) -> dict[str, Any]:
    path = _DIR / f"{code.lower()}.yaml"
    if not path.exists():
        raise KeyError(f"no country pack for {code}")
    return yaml.safe_load(path.read_text(encoding="utf-8"))


def available_packs() -> list[str]:
    return sorted(p.stem.upper() for p in _DIR.glob("*.yaml"))
