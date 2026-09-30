"""Request bounds and response evidence for Enrichlayer's shared-key result prices."""

from treg.application.call import enrichlayer


def test_search_premium_hold_and_returned_result_settlement():
    endpoint = "enrichlayer.people.search"
    cost = {"value": 3, "enrichlayer": {
        "field": "results", "max_page": 10,
        "extra_per_result": {"enrich_profiles": {"enrich": 1}, "use_cache": {"if-recent": 2}},
    }}
    query = {"page_size": "2", "enrich_profiles": "enrich", "use_cache": "if-recent"}
    assert enrichlayer.invalid_platform_parameter(endpoint, query, cost) is None
    hold, unit = enrichlayer.estimate_micro(endpoint, cost, query, 100000)
    assert (hold, unit) == (1200000, 600000)
    assert enrichlayer.observed_micro(cost["enrichlayer"], unit, {"results": [{}]}, hold) == 600000
    assert enrichlayer.observed_micro(cost["enrichlayer"], unit, {"results": []}, hold) == 0
    assert enrichlayer.observed_micro(cost["enrichlayer"], unit, {}, hold) is None
    assert enrichlayer.observed_micro(cost["enrichlayer"], unit, {"results": [{}, {}, {}]}, hold) is None


def test_shared_key_rejects_unbounded_or_unpriced_requests():
    search = {"value": 3, "enrichlayer": {"field": "results", "max_page": 10}}
    endpoint = "enrichlayer.people.search"
    for page in ("0", "11", "1" * 5000):
        assert enrichlayer.invalid_platform_parameter(endpoint, {"page_size": page}, search) == "page_size"
    assert enrichlayer.invalid_platform_parameter(
        endpoint, {"page_size": "11", "use_cache": "if-recent"}, search) == "page_size"
    profile = "enrichlayer.company.profile"
    assert enrichlayer.invalid_platform_parameter(profile, {}, {}) == "use_cache"
    assert enrichlayer.invalid_platform_parameter(profile, {"use_cache": "if-present"}, {}) is None
    employees = "enrichlayer.company.employees.list"
    employee_cost = {"value": 3, "enrichlayer": {"field": "employees", "max_page": 10}}
    assert enrichlayer.invalid_platform_parameter(
        employees, {"page_size": "1", "country": "US"}, employee_cost) == "country"
    phone = "enrichlayer.contacts.personal-phone"
    phone_cost = {"value": 1, "enrichlayer": {"field": "numbers", "max_page": 10}}
    assert enrichlayer.invalid_platform_parameter(phone, {}, phone_cost) == "page_size"
    assert enrichlayer.invalid_platform_parameter(phone, {"page_size": "11"}, phone_cost) == "page_size"
    assert enrichlayer.invalid_platform_parameter(employees, {"page_size": "11"}, employee_cost) == "page_size"


def test_personal_email_precise_counts_valid_and_invalid_found_addresses():
    endpoint = "enrichlayer.contacts.personal-email"
    cost = {"value": 1, "enrichlayer": {"field": "emails", "max_page": 10,
                                        "extra_per_result": {"email_validation": {"precise": 1}}}}
    query = {"page_size": "2", "email_validation": "precise"}
    hold, unit = enrichlayer.estimate_micro(endpoint, cost, query, 100000)
    assert (hold, unit) == (400000, 200000)
    assert enrichlayer.observed_micro(cost["enrichlayer"], unit, {
        "emails": ["valid@example.com"], "invalid_emails": ["invalid@example.com"]}, hold) == 400000
