"""Backwards-compatible re-export: rendering now lives in forsa.matching.render (usable by services)."""

from forsa.matching.render import concept_label, render_match

__all__ = ["concept_label", "render_match"]
