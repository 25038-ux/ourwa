from forsa.assistant.planner import _company_name, compose, plan


def test_red_list_questions_route_to_check():
    assert plan("Est-ce que EBPF est sur la liste rouge ?") == [("check_red_list", {"name": "EBPF"})]
    assert plan("Is « Sahel BTP » on the red list?")[0] == ("check_red_list", {"name": "Sahel BTP"})
    assert plan("Montre la liste rouge")[0][0] == "check_red_list"


def test_winner_questions_route_to_market():
    tool, args = plan("Qui gagne les marchés de forage ?")[0]
    assert tool == "market_winners" and args.get("query")
    assert plan("Who won contracts recently?")[0] == ("market_winners", {})


def test_company_name_extraction():
    assert _company_name('Vérifie la société "MAURIHYDRO"') == "MAURIHYDRO"


def test_compose_red_list_and_winners():
    txt = compose(
        [("check_red_list", {"name": "EBPF", "matches": [{"entity_name": "EBPF", "nature": "Exclusion"}]})], "fr"
    )
    assert "liste rouge" in txt and "EBPF" in txt
    txt = compose(
        [("market_winners", {"query": None, "awards": 3, "items": [{"name": "ACME", "wins": 2, "buyers": []}]})], "en"
    )
    assert "ACME (2)" in txt


def test_market_search_crosses_languages():
    from forsa.services.market import search_terms

    # Notices are mostly French: an English question about drilling must also look for "forage".
    terms = search_terms("drilling")
    assert {"drilling", "forage", "forages"} <= set(terms)
    assert "solaire" in search_terms("solar")
    assert search_terms("EMHAN") == ["EMHAN"]  # a company name stays as typed
