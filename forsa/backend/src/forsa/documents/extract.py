"""File validation + text extraction with page boundaries preserved (spec §20).

OCR and malware scanning are *ports*: the default adapters report honestly that
nothing was done (``needs_ocr`` / ``scan_status="NOT_SCANNED"``) so documents are
routed to human review instead of being silently treated as empty or safe.
"""

from __future__ import annotations

import io
import re
import zipfile
from dataclasses import dataclass, field
from html.parser import HTMLParser
from xml.etree import ElementTree as ET

MAX_BYTES = 40 * 1024 * 1024
ALLOWED_TYPES = {
    "application/pdf": "pdf",
    "text/html": "html",
    "text/plain": "text",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
}


class UnsupportedDocument(ValueError):
    pass


@dataclass(slots=True)
class Page:
    number: int
    text: str


@dataclass(slots=True)
class ExtractedDocument:
    kind: str
    pages: list[Page]
    needs_ocr: bool = False
    warnings: list[str] = field(default_factory=list)

    @property
    def text(self) -> str:
        return "\n\n".join(p.text for p in self.pages)


def sniff_kind(content: bytes, declared_type: str | None = None) -> str:
    """Validate by magic bytes — never trust the declared MIME type alone."""
    head = content[:1024].lstrip()
    if head.startswith(b"%PDF-"):
        return "pdf"
    if head.startswith(b"PK\x03\x04"):
        with zipfile.ZipFile(io.BytesIO(content)) as zf:
            if "word/document.xml" in zf.namelist():
                return "docx"
        raise UnsupportedDocument("zip archives are not accepted (only DOCX)")
    lowered = head[:200].lower()
    if lowered.startswith((b"<!doctype html", b"<html")) or b"<body" in content[:4096].lower():
        return "html"
    try:
        content[:4096].decode("utf-8")
    except UnicodeDecodeError as exc:
        raise UnsupportedDocument(f"unsupported binary type {declared_type!r}") from exc
    return "text"


class _TextHTML(HTMLParser):
    _BLOCK = {"p", "div", "br", "li", "tr", "h1", "h2", "h3", "h4", "h5", "h6", "section", "article", "td", "th"}

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self._skip = 0

    def handle_starttag(self, tag: str, attrs: list) -> None:
        if tag in ("script", "style", "noscript"):
            self._skip += 1
        elif tag in self._BLOCK:
            self.parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag in ("script", "style", "noscript") and self._skip:
            self._skip -= 1
        elif tag in self._BLOCK:
            self.parts.append("\n")

    def handle_data(self, data: str) -> None:
        if not self._skip:
            self.parts.append(data)


def html_to_text(html: str) -> str:
    parser = _TextHTML()
    parser.feed(html)
    text = "".join(parser.parts)
    text = re.sub(r"[ \t ]+", " ", text)
    return re.sub(r"\n\s*\n+", "\n\n", text).strip()


def _docx_text(content: bytes) -> str:
    with zipfile.ZipFile(io.BytesIO(content)) as zf:
        info = zf.getinfo("word/document.xml")
        if info.file_size > MAX_BYTES:
            raise UnsupportedDocument("docx body too large")
        xml = zf.read(info)
    root = ET.fromstring(xml)  # noqa: S314 — DOCX from size-checked upload; no DTD/entity expansion in ET
    ns = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
    paras = []
    for p in root.iter(f"{ns}p"):
        paras.append("".join(t.text or "" for t in p.iter(f"{ns}t")))
    return "\n".join(paras)


def extract(content: bytes, declared_type: str | None = None) -> ExtractedDocument:
    if len(content) > MAX_BYTES:
        raise UnsupportedDocument("file too large")
    kind = sniff_kind(content, declared_type)
    if kind == "pdf":
        from pypdf import PdfReader

        reader = PdfReader(io.BytesIO(content))
        pages = [Page(i + 1, (page.extract_text() or "").strip()) for i, page in enumerate(reader.pages)]
        empty = sum(1 for p in pages if len(p.text) < 20)
        doc = ExtractedDocument("pdf", pages, needs_ocr=bool(pages) and empty / len(pages) > 0.5)
        if doc.needs_ocr:
            doc.warnings.append("scanned_pdf_ocr_required")
        return doc
    if kind == "docx":
        return ExtractedDocument("docx", [Page(1, _docx_text(content))])
    text = content.decode("utf-8", errors="replace")
    if kind == "html":
        return ExtractedDocument("html", [Page(1, html_to_text(text))])
    return ExtractedDocument("text", [Page(1, text)])
