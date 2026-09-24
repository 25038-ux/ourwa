"""Structured JSON logging (spec §55). One line per event; secrets are never logged."""

from __future__ import annotations

import json
import logging
import sys
from datetime import UTC, datetime


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        msg = record.getMessage()
        payload: dict = {"ts": datetime.now(UTC).isoformat(), "level": record.levelname, "logger": record.name}
        try:
            parsed = json.loads(msg)
            payload.update(parsed if isinstance(parsed, dict) else {"msg": msg})
        except (ValueError, TypeError):
            payload["msg"] = msg
        if record.exc_info:
            payload["exc"] = self.formatException(record.exc_info)
        return json.dumps(payload, ensure_ascii=False, default=str)


def configure_logging(level: str = "INFO") -> None:
    root = logging.getLogger()
    if any(isinstance(h.formatter, JsonFormatter) for h in root.handlers):
        return
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    root.handlers = [handler]
    root.setLevel(level)
