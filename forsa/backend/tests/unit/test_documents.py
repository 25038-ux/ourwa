import io
import zipfile

import pytest

from forsa.documents.extract import Page, UnsupportedDocument, extract, html_to_text, sniff_kind
from forsa.documents.requirements import extract_requirements, to_specs
from forsa.documents.segment import segment_pages
from forsa.matching.profiles import ReqKind
from forsa.taxonomy import default_ontology

DAO = """DOSSIER D'APPEL D'OFFRES
Article 5 Qualification des soumissionnaires
5.1 Le soumissionnaire doit fournir une attestation fiscale en cours de validité.
5.2 Le soumissionnaire doit avoir réalisé au moins trois (3) marchés similaires au cours des cinq dernières années.
5.3 Le chiffre d'affaires annuel moyen doit être supérieur ou égal à 50 000 000 MRU.
5.4 La certification ISO 9001 sera notée (10 points).
Article 6 Présentation des offres
Les offres seront remises en trois exemplaires, sous pli fermé, sous peine de rejet.
Le présent avis est publié pour information.
"""


def test_segments_keep_heading_path_and_offsets():
    page = Page(3, DAO)
    segs = segment_pages([page])
    clause = next(s for s in segs if "attestation fiscale" in s.text)
    assert clause.page == 3
    assert clause.heading_path[0].startswith("DOSSIER")
    assert any(h.startswith("Article 5") for h in clause.heading_path)
    assert page.text[clause.start : clause.end] == clause.text


def test_requirement_extraction_french_dao():
    reqs = extract_requirements([Page(1, DAO)], default_ontology())
    by_cat = {r.category: r for r in reqs}
    tax = next(r for r in reqs if "cred.tax_clearance" in r.credential_ids)
    assert tax.type == "mandatory"
    assert by_cat["experience"].min_count == 3
    fin = by_cat["financial"]
    assert fin.min_amount == 50_000_000 and fin.currency == "MRU"
    iso = next(r for r in reqs if "cred.iso_9001" in r.credential_ids)
    assert iso.type == "scored"
    assert any(r.category == "formatting" for r in reqs)
    assert not any("pour information" in r.text for r in reqs)


def test_requirement_specs_carry_citation():
    reqs = extract_requirements([Page(2, DAO)], default_ontology())
    specs = [s for r in reqs for s in to_specs(r, evidence_id="ev-9")]
    kinds = {s.kind for s in specs}
    assert {ReqKind.CREDENTIAL, ReqKind.EXPERIENCE, ReqKind.FINANCIAL_TURNOVER} <= kinds
    for s in specs:
        assert s.evidence and s.evidence.locator.startswith("p.2") and s.evidence.evidence_id == "ev-9"


def test_arabic_and_english_mandatory_markers():
    onto = default_ontology()
    ar = extract_requirements([Page(1, "يجب على المتعهد تقديم شهادة ضريبية سارية المفعول.")], onto)
    assert ar and ar[0].credential_ids == ["cred.tax_clearance"]
    en = extract_requirements([Page(1, "Bidders must provide at least two similar contracts completed.")], onto)
    assert en and en[0].category == "experience" and en[0].min_count == 2


def test_um_currency_flagged_as_ambiguous():
    reqs = extract_requirements([Page(1, "Le chiffre d'affaires doit atteindre 20 millions UM.")], default_ontology())
    assert reqs[0].min_amount == 20_000_000 and "currency_um_may_be_pre_2018_mro" in reqs[0].notes


def test_sniff_rejects_binary_and_zip():
    with pytest.raises(UnsupportedDocument):
        sniff_kind(b"\x00\x01\x02\xff" * 10)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("evil.txt", "x")
    with pytest.raises(UnsupportedDocument):
        sniff_kind(buf.getvalue())


def test_html_and_docx_extraction():
    assert "Avis" in html_to_text("<html><script>ignore()</script><body><h1>Avis</h1><p>Texte</p></body></html>")
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr(
            "word/document.xml",
            '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
            "<w:body><w:p><w:r><w:t>Le soumissionnaire doit fournir le RCCM.</w:t></w:r></w:p></w:body>"
            "</w:document>",
        )
    doc = extract(buf.getvalue())
    assert doc.kind == "docx" and "RCCM" in doc.text


def test_pdf_without_text_is_flagged_for_ocr():
    from pypdf import PdfWriter

    w = PdfWriter()
    w.add_blank_page(width=200, height=200)
    out = io.BytesIO()
    w.write(out)
    doc = extract(out.getvalue())
    assert doc.kind == "pdf" and doc.needs_ocr and "scanned_pdf_ocr_required" in doc.warnings


def test_clause_with_two_obligations_yields_both_specs():
    reqs = extract_requirements(
        [
            Page(
                1,
                "Le soumissionnaire doit disposer de la certification ISO 9001 et d'au moins cinq marchés similaires.",
            )
        ],
        default_ontology(),
    )
    specs = [s for r in reqs for s in to_specs(r)]
    kinds = {(s.kind, s.credential_id, s.min_count) for s in specs}
    assert (ReqKind.CREDENTIAL, "cred.iso_9001", None) in kinds
    assert (ReqKind.EXPERIENCE, None, 5) in kinds


def test_product_warranty_is_not_financial():
    reqs = extract_requirements(
        [Page(1, "Les ordinateurs doivent être livrés avec une garantie de 12 mois.")], default_ontology()
    )
    assert reqs and reqs[0].category == "technical" and reqs[0].min_amount is None


def test_clause_numbers_are_kept_in_citations():
    reqs = extract_requirements(
        [Page(1, "5.1 Le soumissionnaire doit fournir une attestation fiscale.")], default_ontology()
    )
    assert reqs[0].text.startswith("5.1 Le soumissionnaire")
