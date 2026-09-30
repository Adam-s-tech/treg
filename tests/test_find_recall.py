"""Recall by job for /catalog/find (domain.catalog.find_recall): pure functions over a small catalog
built here, so each rule is pinned on rows whose words are chosen for it - tokens and stemming,
whole-word and prefix hits, member pooling and its representatives, seats, the name table."""
from __future__ import annotations

from treg.domain.catalog import find_recall as fr
from treg.domain.catalog import store


def _ep(eid, cap, platform, provider, name, summary="", kind="data"):
    return {"id": eid, "capability": cap, "platform": platform, "provider": provider, "name": name,
            "summary": summary, "kind": kind, "tier": "core", "verified": True, "path": "/", "cost": None}


def _cat() -> store.Catalog:
    eps = [
        _ep("hunter.people.email.find", "people.email.find", "people", "hunter", "Email finder",
            "Find the work email for a name and a company domain"),
        _ep("leadco.people.email.find", "people.email.find", "people", "leadco", "Work email lookup",
            "Look up a professional email"),
        _ep("perso.people.email.find", "people.email.find", "people", "persomail", "Personal email finder",
            "Find someone's personal gmail address"),
        _ep("apollo.people.search", "people.search", "people", "apollo", "People search",
            "Search people by title and company"),
        _ep("pdl.people.search", "people.search", "people", "pdl", "Person search", "Filter people"),
        _ep("tt.tiktok.video.comments", "tiktok.video.comments", "tiktok", "tikdata", "Video comments",
            "List the comments on a video"),
        _ep("tiktok-ads.library.search", "tiktok-ads.library.search", "tiktok-ads", "adspy", "Ad library search",
            "Search running ads"),
        _ep("replicate.flux.schnell", "image-gen.flux.generate", "image-gen", "replicate", "FLUX Schnell",
            "Generate an image from a prompt"),
        _ep("falco.flux.pro", "image-gen.flux.generate", "image-gen", "falco", "FLUX Pro",
            "Generate an image from a prompt"),
        _ep("scrapecreators.x.trending", "", "tiktok", "scrapecreators", "Trending videos",
            "Videos trending on TikTok today"),
        _ep("hunter.account.usage", "", "people", "hunter", "Account usage", "Credits left", kind="utility"),
    ]
    return store.Catalog(
        platforms={
            "people": {"label": "People", "category": "Enrichment"},
            "tiktok": {"label": "TikTok", "category": "Social"},
            "tiktok-ads": {"label": "TikTok Ads", "category": "Advertising"},
            "image-gen": {"label": "Image generation", "category": "AI generation"},
        },
        capabilities={
            "people.email.find": "Find a person's work email from their name and company",
            "people.search": "Find people by role, company or location",
            "tiktok.video.comments": "List a video's comments",
            "tiktok-ads.library.search": "Search the TikTok ad library",
            "image-gen.flux.generate": "Generate images with FLUX",
        },
        endpoints=eps, by_id={e["id"]: e for e in eps},
        aliases={"t2i": ["text-to-image"], "mail": ["email"]},
    )


def _ids(cands, via=None):
    return [c.unit.id for c in cands if via is None or c.via == via]


def test_tokens_fold_stem_and_drop_filler():
    assert fr.query_tokens("Find the E-mails of CEOs") == ["find", "mail", "ceo"]
    assert fr.query_tokens("scraping scraped scrapes scrape") == ["scrap"] * 4
    assert fr.query_tokens("companies searches boxes") == ["company", "search", "box"]
    assert fr.query_tokens("données für la société") == ["donne", "fur", "societ"]   # diacritics folded
    assert fr.query_tokens("抖音 评论") == ["抖音", "评论"]                             # CJK kept


def test_the_index_holds_jobs_and_shown_endpoints_only():
    ix = fr.build(_cat())
    kinds = {u.id: u.kind for u in ix.units}
    assert kinds["people.email.find"] == fr.JOB and kinds["hunter.people.email.find"] == fr.ENDPOINT
    assert "hunter.account.usage" not in kinds                       # utility: not on the browse surface
    # a first-party endpoint may carry its capability's id: two units, told apart by kind
    same = "tiktok-ads.library.search"
    assert ix.units[ix.job_pos[same]].kind == fr.JOB and ix.units[ix.pos[same]].kind == fr.ENDPOINT
    assert ix.members[ix.job_pos[same]] == [ix.pos[same]]
    job = ix.units[ix.job_pos["people.email.find"]]
    assert job.providers == ("hunter", "leadco", "persomail") and len(job.members) == 3
    assert "Email finder" in job.text and "work email" in job.text


def test_whole_words_only_and_a_long_prefix_hits_names_at_half_weight():
    cat = _cat()
    ix = fr.build(cat)
    lex = fr.lexical("comment", ix, cat.aliases)
    assert lex[ix.pos["tt.tiktok.video.comments"]] > 0
    assert fr.lexical("comm", ix, cat.aliases)[ix.pos["tt.tiktok.video.comments"]] == 0   # no substring hits
    # "scrap" (5 letters) starts a provider's name: a hit, worth half a whole word
    half = fr.lexical("scrap", ix, cat.aliases)[ix.pos["scrapecreators.x.trending"]]
    whole = fr.lexical("trend", ix, cat.aliases)[ix.pos["scrapecreators.x.trending"]]
    assert 0 < half < whole
    # an alias phrase hits where all its words are
    assert fr.lexical("mail", ix, cat.aliases)[ix.job_pos["people.email.find"]] > 0


def test_a_job_pools_its_members_and_the_winning_member_is_its_representative():
    cat = _cat()
    ix = fr.build(cat)
    cands = fr.recall("find someone's personal gmail", ix, cat.aliases)
    assert "people.email.find" in _ids(cands)
    assert _ids(cands, "rep") == ["perso.people.email.find"]   # its words fit better than the job card
    # the job card itself wins: no representative
    assert _ids(fr.recall("work email", ix, cat.aliases), "rep") == []
    # a one-vendor job and its member are the same thing
    assert "tt.tiktok.video.comments" not in _ids(fr.recall("video comments", ix, cat.aliases), "rep")


def test_order_is_jobs_then_representatives_then_uncatalogued():
    cat = _cat()
    cands = fr.recall("trending tiktok video comments", fr.build(cat), cat.aliases)
    kinds = [(c.unit.kind, bool(c.unit.cap), c.via) for c in cands]
    assert kinds == sorted(kinds, key=lambda k: (k[0] != fr.JOB, k[2] != "rep"))
    assert "scrapecreators.x.trending" in _ids(cands)


def test_seats_go_first_to_the_platform_the_query_names_and_stop_at_the_quota():
    cat = _cat()
    ix = fr.build(cat)
    def jobs(**kw):
        return [c.unit for c in fr.recall("tiktok work email finder", ix, cat.aliases, **kw) if c.unit.kind == fr.JOB]
    assert [u.id for u in jobs(n_jobs=1, n_plat=0)] == ["people.email.find"]
    seated = jobs(n_jobs=2, n_plat=1)
    assert len(seated) == 2 and seated[0].platform == "tiktok" and seated[1].id == "people.email.find"
    assert all(c.unit.kind != fr.JOB for c in fr.recall("people", ix, cat.aliases, n_jobs=0))


def test_a_semantic_channel_fuses_with_the_lexical_one_and_a_shelf_scopes_both():
    cat = _cat()
    ix = fr.build(cat)
    assert "image-gen.flux.generate" not in _ids(fr.recall("make a picture", ix, cat.aliases))
    sem = [0.0] * len(ix.units)
    sem[ix.pos["falco.flux.pro"]] = 0.8
    cands = fr.recall("make a picture", ix, cat.aliases, semantic=sem)
    assert "image-gen.flux.generate" in _ids(cands) and _ids(cands, "rep") == ["falco.flux.pro"]
    scoped = fr.recall("email comments", ix, cat.aliases, platform="tiktok")
    assert {c.unit.platform for c in scoped} == {"tiktok"}


def test_names_platform_then_provider_then_product():
    ix = fr.build(_cat())
    hit = fr.name_of("TikTok", ix)
    assert hit.kind == "platform" and hit.keys[0] == "tiktok" and hit.exact and "tiktok-ads" in hit.keys
    assert fr.name_of("tiktok a", ix).keys == ("tiktok-ads",)                 # a typed prefix of a label
    prefix = fr.name_of("tikt", ix)
    assert prefix.kind == "platform" and not prefix.exact
    assert fr.name_of("pdl", ix) == fr.NameHit("provider", ("pdl",), exact=True)   # any length when exact
    assert fr.name_of("scrapecr", ix).keys == ("scrapecreators",)
    assert fr.name_of("scr", ix) is None                                       # a prefix needs four letters
    product = fr.name_of("flux", ix)
    assert product.kind == "product" and set(product.keys) == {"replicate.flux.schnell", "falco.flux.pro"}
    assert fr.name_of("find a work email", ix) is None
    # on a shelf only a provider there counts
    assert fr.name_of("tiktok", ix, platform="people") is None
    assert fr.name_of("hunter", ix, platform="people").keys == ("hunter",)


def test_the_index_is_built_once_per_catalog():
    cat = _cat()
    assert fr.index(cat) is fr.index(cat)
    assert fr.index(_cat()) is not fr.index(cat)
