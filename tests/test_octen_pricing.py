"""Octen holds bound the upstream bill; settlement uses only this response's usage."""

import json
from types import SimpleNamespace

import pytest

from treg.application.call import octen
from treg.application.call import resolve, settle
from treg.application.call.types import ResolutionFailed


RATES = {
    "octen.web.search": {"call": 5000, "full_content_extra": 500},
    "octen.web.search.broad": {"subquery": 5000, "full_content_extra": 500},
    "octen.web.search.news": {"call": 3000, "full_content_extra": 500},
    "octen.web.extract": {"standard": 1000, "advanced": 2500},
}


@pytest.mark.parametrize("endpoint,payload,hold,usage,settled", [
    ("octen.web.search", {"query": "x", "count": 11}, 5000,
     {"num_search_queries": 1, "full_content_extra_count": 0}, 5000),
    ("octen.web.search", {"query": "x", "count": 11, "full_content": {"enable": True}}, 5500,
     {"num_search_queries": 1, "full_content_extra_count": 1}, 5500),
    ("octen.web.search.broad", {"query": "x", "max_queries": 4,
                                "search_options": {"count": 12, "full_content": {"enable": True}}},
     24000, {"num_search_queries": 2, "full_content_extra_count": 1}, 10500),
    ("octen.web.search.news", {"query": "x", "count": 11,
                               "subjects": {"enable": False}, "full_content": {"enable": True}},
     3500, {"num_search_queries": 1, "num_subject_search_queries": 0,
            "full_content_extra_count": 1}, 3500),
    ("octen.web.extract", {"urls": ["https://example.com", "https://example.invalid"],
                           "mode": "auto"}, 5000,
     {"total_urls": 2, "successful_urls": 1,
      "successful_by_mode": {"standard_urls": 1, "advanced_urls": 0}}, 1000),
])
def test_hold_and_actual_usage(endpoint, payload, hold, usage, settled):
    body = json.dumps(payload).encode()
    assert octen.invalid_platform_parameter(endpoint, body) is None
    assert octen.estimate_micro(endpoint, RATES[endpoint], body) == hold
    doc = {"code": 0, "meta": {"usage": usage}}
    assert octen.observed_micro(endpoint, RATES[endpoint], {"body": payload}, doc, hold) == settled


def test_news_hold_covers_subject_results_when_full_content_is_enabled():
    request = {"query": "x", "count": 100, "subjects": {"count": 5, "max_sub_news": 20},
               "full_content": {"enable": True}}
    assert octen.estimate_micro("octen.web.search.news", RATES["octen.web.search.news"],
                                json.dumps(request).encode()) == 98000


@pytest.mark.parametrize("endpoint,payload,field", [
    ("octen.web.search", {"query": "x", "count": 101}, "body.count"),
    ("octen.web.search", {"query": "x", "full_content": {"enable": "yes"}},
     "body.full_content"),
    ("octen.web.search.broad", {"query": "x", "max_queries": 31}, "body.max_queries"),
    ("octen.web.search.broad", {"query": "x", "search_options": {"count": 101}},
     "body.search_options.count"),
    ("octen.web.search.news", {"query": "x", "subjects": {"max_sub_news": 21}},
     "body.subjects.max_sub_news"),
    ("octen.web.extract", {"urls": ["https://example.com"] * 21}, "body.urls"),
])
def test_platform_rejects_unbounded_request(endpoint, payload, field):
    assert octen.invalid_platform_parameter(endpoint, json.dumps(payload).encode()) == field


def test_missing_or_impossible_usage_cannot_settle_as_zero_or_exceed_hold():
    endpoint = "octen.web.search.broad"
    request = {"body": {"query": "x", "max_queries": 1}}
    rates = RATES[endpoint]
    assert octen.observed_micro(endpoint, rates, request, {"code": 0}, 5000) is None
    assert octen.observed_micro(endpoint, rates, request, {"code": 400}, 5000) == 0
    assert octen.observed_micro(endpoint, rates, request, {"code": 0, "meta": {"usage": {
        "num_search_queries": 2, "full_content_extra_count": 0}}}, 5000) is None
    assert octen.observed_micro(endpoint, rates, request, {"code": 0, "meta": {"usage": {
        "num_search_queries": True, "full_content_extra_count": 0}}}, 5000) is None


def test_rate_table_must_be_complete_and_micro_precise():
    endpoint = "octen.web.extract"
    assert octen.rates_micro(endpoint, {"octen_rates": {
        "standard": 0.001, "advanced": 0.0025}}) == RATES[endpoint]
    for rates in ({"standard": 0.001}, {"standard": 0, "advanced": 0.0025},
                  {"standard": 0.0010001, "advanced": 0.0025}):
        with pytest.raises(ValueError):
            octen.rates_micro(endpoint, {"octen_rates": rates})


def test_call_runtime_uses_frozen_octen_rates_and_checks_platform_shape():
    endpoint = "octen.web.extract"
    payload = {"urls": ["https://example.com"], "mode": "auto"}
    body = json.dumps(payload).encode()
    cost = {"octen_rates": {"standard": 0.001, "advanced": 0.0025}}
    assert resolve._marketplace_pricing("octen", endpoint, cost, {}, body) == (2500, 0)
    mk = SimpleNamespace(
        provider="octen", endpoint_id=endpoint, cost_type="per_success",
        estimate_micro=2500, request_data={"body": payload},
        settlement_basis={"octen_rates_micro": RATES[endpoint]},
    )
    result = {"code": 0, "meta": {"usage": {"successful_urls": 1,
              "successful_by_mode": {"standard_urls": 1, "advanced_urls": 0}}}}
    assert settle._observed_cost_micro(mk, json.dumps(result).encode()) == 1000
    with pytest.raises(ResolutionFailed) as caught:
        resolve._enforce_platform_request({"provider": "octen", "id": endpoint},
                                          json.dumps({"urls": ["https://example.com"] * 21}).encode())
    assert caught.value.kind == "catalog_parameter_invalid"
