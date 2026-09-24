---
name: document-intelligence
description: Work on document extraction, OCR routing, segmentation and requirement extraction (backend/src/forsa/documents). Use when parsing tenders/DAOs or company evidence.
---

# document-intelligence

1. Keep page numbers and character offsets exact — citations depend on them (`Segment.locator`).
2. Validate files by magic bytes; never trust MIME types; refuse archives unless explicitly supported.
3. Scanned pages → `needs_ocr` + human review, never "empty document".
4. Extraction rules: add a golden case in `evals/extraction/` first, then change `requirements.py`.
5. Bump `EXTRACTOR_VERSION` when behaviour changes; requirements store `extraction_method`.
6. Measure against the real-document benchmark once available (Phase 4 gate).
