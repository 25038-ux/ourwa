from datetime import UTC, datetime

from forsa.documents.deadlines import find_deadline
from forsa.documents.extract import Page


def _find(text: str):
    return find_deadline([Page(1, text)])


def test_armp_numeric_date_with_time_ocr_spacing():
    # Real phrasing from a PNMP notice (OCR output, spacing preserved).
    hit = _find(
        "L'Agence Nationale pour l'Emploi sollicite des offres. Les offres devront être déposées au plus tard "
        "le Mardi 01/09/2026 à 12h 00 TU à l'adresse suivante. L'ouverture des plis aura lieu le 01/09/2026 à 12h30."
    )
    assert hit is not None
    assert hit.deadline == datetime(2026, 9, 1, 12, 0, tzinfo=UTC)
    assert hit.has_time
    assert "au plus tard" in hit.quote


def test_month_name_with_accent_and_heures():
    hit = _find(
        "Les manifestations d'intérêt doivent être déposées au plus tard le 20 Août 2026 à 12heures, heure locale."
    )
    assert hit and hit.deadline == datetime(2026, 8, 20, 12, 0, tzinfo=UTC) and hit.has_time


def test_opening_date_alone_is_not_a_deadline():
    assert _find("L'ouverture des plis aura lieu le 15/10/2026 à 10h00 en séance publique.") is None


def test_publication_date_is_ignored():
    assert _find("Avis général publié le 23/03/2026 sur le site de l'ARMP.") is None


def test_english_month_first():
    hit = _find("Bids must be delivered to the address below no later than October 7, 2026 at 4:00 pm.")
    assert hit and hit.deadline == datetime(2026, 10, 7, 16, 0, tzinfo=UTC)


def test_arabic_digits_and_month():
    hit = _find("آخر أجل لإيداع العروض هو ١٥ أكتوبر 2026 على الساعة 10:00")
    assert hit and hit.deadline.date().isoformat() == "2026-10-15" and hit.deadline.hour == 10


def test_date_without_time_defaults_to_midday_and_is_flagged():
    hit = _find("Date limite de dépôt des offres : 30/11/2026")
    assert hit and hit.deadline.hour == 12 and not hit.has_time


def test_weak_anchor_needs_a_subject():
    assert _find("Le projet sera achevé avant le 31/12/2026.") is None
    assert _find("Les offres sont reçues avant le 31/12/2026 à 09h00.") is not None


def test_invalid_dates_are_skipped():
    assert _find("Date limite de dépôt des offres : 31/02/2026") is None
