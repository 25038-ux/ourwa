"""The only door to the network for connectors: allowlist, HTTPS only, robots.txt, honest failures."""

import httpx
import pytest

from forsa.ingestion.http import HttpPolicy, PoliteHttpClient, RobotsDisallowed, RobotsUnavailable
from forsa.kernel.errors import SourcePolicyViolation


def _client(handler) -> PoliteHttpClient:
    policy = HttpPolicy(allowed_hosts=frozenset({"src.test"}), min_interval_s=0, allow_private_networks=True)
    return PoliteHttpClient(policy, "FORSA-test", transport=httpx.MockTransport(handler), sleep=lambda _: None)


def test_missing_robots_txt_allows_crawling():
    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(404) if req.url.path == "/robots.txt" else httpx.Response(200, text="ok")

    assert _client(handler).get("https://src.test/api/x").status == 200


def test_robots_disallow_is_respected():
    def handler(req: httpx.Request) -> httpx.Response:
        if req.url.path == "/robots.txt":
            return httpx.Response(200, text="User-agent: *\nDisallow: /api/")
        return httpx.Response(200)

    with pytest.raises(RobotsDisallowed):
        _client(handler).get("https://src.test/api/x")


def test_unreachable_robots_is_reported_as_unavailable_not_disallowed():
    def handler(req: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("no route", request=req)

    with pytest.raises(RobotsUnavailable, match="unreachable"):
        _client(handler).get("https://src.test/api/x")


@pytest.mark.parametrize("url", ["https://other.test/x", "http://src.test/x"])
def test_allowlist_and_https_only(url):
    with pytest.raises(SourcePolicyViolation):
        _client(lambda req: httpx.Response(200)).get(url)


def test_extra_headers_are_sent():
    seen = {}

    def handler(req: httpx.Request) -> httpx.Response:
        seen.update(req.headers)
        return httpx.Response(404) if req.url.path == "/robots.txt" else httpx.Response(200)

    _client(handler).get("https://src.test/api/x", headers={"Authorization": "bearer t"})
    assert seen["authorization"] == "bearer t"
