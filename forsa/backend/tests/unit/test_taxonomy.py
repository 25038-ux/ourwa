from forsa.taxonomy import default_ontology
from forsa.taxonomy.normalize import detect_language, normalize_arabic, normalize_key, tokenize


def test_tokens_keep_original_spans():
    text = "Fourniture de panneaux solaires à Kiffa"
    for tok in tokenize(text):
        assert text[tok.start : tok.end]


def test_french_plural_and_accents_fold():
    assert normalize_key("Panneaux Solaires") == normalize_key("panneau solaire")
    assert normalize_key("Réhabilitation") == normalize_key("rehabilitation")


def test_arabic_normalisation():
    assert normalize_arabic("الطاقة") == normalize_arabic("طاقه")
    assert normalize_arabic("إنشاء") == normalize_arabic("انشاء")


def test_same_capability_in_three_languages():
    onto = default_ontology()
    fr = onto.concepts_in("Installation photovoltaïque dans 20 écoles")
    ar = onto.concepts_in("تركيب أنظمة الطاقة الشمسية في المدارس")
    en = onto.concepts_in("Solar photovoltaic installation for schools")
    assert "energy.solar_pv" in fr and "energy.solar_pv" in ar and "energy.solar_pv" in en


def test_hit_quotes_original_text():
    onto = default_ontology()
    text = "Travaux de réalisation de forages équipés de pompes solaires"
    hits = onto.find(text)
    assert {h.concept_id for h in hits} == {"water.drilling", "energy.solar_pumping"}
    for h in hits:
        assert text[h.start : h.end] == h.quote


def test_credentials_are_separate_kind():
    onto = default_ontology()
    assert onto.find("attestation fiscale") == []
    creds = onto.find("attestation fiscale et ISO 9001", kinds=("credential",))
    assert {h.concept_id for h in creds} == {"cred.tax_clearance", "cred.iso_9001"}


def test_similarity_hierarchy():
    onto = default_ontology()
    assert onto.similarity("energy.solar_pv", "energy.solar_pv") == 1.0
    assert onto.similarity("energy.solar_pv", "energy.solar_pumping") > onto.similarity(
        "energy.solar_pumping", "energy.solar_pv"
    )
    assert onto.similarity("it.software", "water.drilling") == 0.0


def test_language_detection():
    assert detect_language("Avis d'appel d'offres pour la fourniture de matériel") == "fr"
    assert detect_language("إعلان عن مناقصة لتوريد معدات") == "ar"
    assert detect_language("Procurement notice for the supply of works") == "en"
