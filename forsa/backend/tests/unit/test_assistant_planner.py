from forsa.assistant.planner import compose, plan, reply_lang, speech_text


def test_spec_example_natural_language_search():
    steps = plan(
        "Show me construction opportunities in Nouakchott under 20 million MRU that my company can "
        "realistically execute."
    )
    name, args = steps[0]
    assert name == "search_opportunities"
    assert args["region"] == "Nouakchott" and args["max_value"] == 20_000_000 and args["exclude_no_bid"]
    assert "construction" in args.get("concepts", []) or args.get("category") == "works"


def test_french_solar_search_and_deadlines_and_why():
    name, args = plan("Trouve-moi des marchés de pompage solaire qui ferment dans 45 jours")[0]
    assert name == "search_opportunities" and "energy.solar_pumping" in args["concepts"]
    assert args["max_days_left"] == 45
    assert plan("Quelles sont les échéances cette semaine ?")[0] == ("upcoming_deadlines", {"days": 7})
    assert plan("Pourquoi ce no-bid ?", focus_opportunity_id="abc")[0] == ("explain_recommendation", {})
    assert plan("Why did you recommend no-bid for DEMO-2026-007?")[0] == (
        "explain_recommendation",
        {"opportunity": "DEMO-2026-007"},
    )


def test_arabic_and_actions_and_default():
    assert plan("ما هي المواعيد النهائية؟")[0][0] == "upcoming_deadlines"
    assert plan("Lance une offre pour DEMO-2026-001")[0] == (
        "propose_action",
        {"action": "start_bid", "opportunity": "DEMO-2026-001"},
    )
    assert plan("Trouve des partenaires", focus_opportunity_id="x")[0][0] == "find_partners"
    assert plan("Bonjour !")[0][0] == "get_briefing"
    assert reply_lang("Which opportunities should we bid on this week?", "fr") == "en"


def test_compose_never_invents_and_flags_estimates():
    items = [{"title": "Kits solaires", "fit": 89, "recommendation": "BID", "days_left": 18.1, "status": "PUBLISHED"}]
    text = compose([("top_recommendations", {"items": items})], "fr")
    assert "Kits solaires" in text and "89/100" in text and "pas des probabilités de gain" in text
    assert compose([("search_opportunities", {"items": [], "total": 0})], "en").startswith("No open opportunity")
    assert "Estimations" not in speech_text(text)
