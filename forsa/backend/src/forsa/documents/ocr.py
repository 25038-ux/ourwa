"""OCR adapter for scanned PDFs (Tesseract via its CLI).

Most notices on the Mauritanian procurement portal are scans with no text layer. This adapter renders each page
with ``pdftoppm`` (poppler) and reads it with ``tesseract`` in French + Arabic + English. It is a *port*: when the
binaries are not installed, ``available()`` is False and documents stay ``NEEDS_OCR`` (never silently empty).

OCR text is less reliable than a text layer: callers must lower confidence and label the extraction method.
"""

from __future__ import annotations

import logging
import os
import shutil
import subprocess
import tempfile
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path

log = logging.getLogger("forsa.ocr")


@dataclass(frozen=True, slots=True)
class OcrConfig:
    langs: str = "fra+ara"
    dpi: int = 200
    max_pages: int = 40
    page_timeout_s: int = 120
    workers: int = max(1, min(4, os.cpu_count() or 1))  # pages in parallel, one single-threaded tesseract each


def _bin(name: str) -> str | None:
    return shutil.which(name)


def available() -> bool:
    return _bin("tesseract") is not None and _bin("pdftoppm") is not None


# All subprocess calls below use absolute executables and a fixed argv (no shell); the only variable parts are
# paths inside a private temporary directory we created and integer settings — no untrusted input reaches argv.


def engine_label() -> str:
    tesseract = _bin("tesseract")
    if tesseract is None:
        return "tesseract (missing)"
    try:
        out = subprocess.run([tesseract, "--version"], capture_output=True, text=True, timeout=10, check=False)  # noqa: S603
        first = (out.stdout or out.stderr).splitlines()[0]
        return first.strip()[:40]
    except (OSError, IndexError, subprocess.TimeoutExpired):
        return "tesseract"


def ocr_pdf(content: bytes, cfg: OcrConfig | None = None) -> list[str] | None:
    """Return one text string per page (up to ``max_pages``), or None when OCR is unavailable or fails."""
    cfg = cfg or OcrConfig()
    pdftoppm, tesseract = _bin("pdftoppm"), _bin("tesseract")
    if pdftoppm is None or tesseract is None:
        return None
    with tempfile.TemporaryDirectory(prefix="forsa-ocr-") as tmp:
        pdf = Path(tmp) / "in.pdf"
        pdf.write_bytes(content)
        try:
            subprocess.run(  # noqa: S603
                [pdftoppm, "-r", str(cfg.dpi), "-gray", "-png", "-l", str(cfg.max_pages), str(pdf), f"{tmp}/p"],
                capture_output=True,
                timeout=cfg.page_timeout_s * 2,
                check=True,
            )
        except (OSError, subprocess.SubprocessError) as exc:
            log.warning("pdftoppm failed: %s", exc)
            return None
        images = sorted(Path(tmp).glob("p-*.png"), key=lambda p: int(p.stem.split("-")[-1]))
        env = {**os.environ, "OMP_THREAD_LIMIT": "1"}  # faster overall than OpenMP threads fighting each other

        def read(image: Path) -> str:
            try:
                out = subprocess.run(  # noqa: S603
                    [tesseract, str(image), "-", "-l", cfg.langs, "--psm", "3"],
                    capture_output=True,
                    text=True,
                    timeout=cfg.page_timeout_s,
                    check=True,
                    env=env,
                )
                return out.stdout.strip()
            except (OSError, subprocess.SubprocessError) as exc:
                log.warning("tesseract failed on %s: %s", image.name, exc)
                return ""

        with ThreadPoolExecutor(max_workers=cfg.workers) as pool:
            return list(pool.map(read, images))
