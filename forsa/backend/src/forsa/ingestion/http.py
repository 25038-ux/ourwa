"""The only way connectors may reach the network (spec §26, §52 SSRF).

* HTTPS only, and only to hosts declared in the source registry (allowlist).
* Hosts resolving to private / loopback / link-local addresses are refused.
* robots.txt is honoured; a disallow blocks the request (never bypassed).
* Polite per-host rate limiting, bounded retries with exponential backoff on
  429/5xx, a circuit breaker after repeated failures, and a response size cap.
* No cookies, no JS, no CAPTCHA solving, no credential stuffing — ever.
"""

from __future__ import annotations

import ipaddress
import socket
import time
import urllib.robotparser
from collections.abc import Callable
from dataclasses import dataclass, field
from urllib.parse import urlparse

import httpx

from forsa.kernel.clock import utcnow
from forsa.kernel.errors import SourcePolicyViolation


class RobotsDisallowed(SourcePolicyViolation):
    code = "robots_disallowed"


class CircuitOpen(RuntimeError):
    pass


class RobotsUnavailable(RuntimeError):
    """robots.txt could not be fetched (network/5xx): we conservatively do not crawl, but it is not a disallow."""


@dataclass
class HttpPolicy:
    allowed_hosts: frozenset[str]
    min_interval_s: float = 2.0
    max_retries: int = 3
    backoff_base_s: float = 2.0
    max_bytes: int = 25 * 1024 * 1024
    timeout_s: float = 30.0
    respect_robots: bool = True
    breaker_threshold: int = 5
    allow_private_networks: bool = False  # tests only


@dataclass
class _HostState:
    last_request: float = 0.0
    consecutive_failures: int = 0
    robots: urllib.robotparser.RobotFileParser | None = None
    robots_error: str | None = None


@dataclass
class FetchResult:
    url: str
    status: int
    content: bytes
    content_type: str | None
    etag: str | None
    last_modified: str | None
    retrieved_at: object = field(default_factory=utcnow)


def _assert_public_host(host: str) -> None:
    try:
        infos = socket.getaddrinfo(host, 443, proto=socket.IPPROTO_TCP)
    except socket.gaierror as exc:
        raise SourcePolicyViolation(f"cannot resolve {host}") from exc
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast:
            raise SourcePolicyViolation(f"{host} resolves to non-public address {ip}")


class PoliteHttpClient:
    def __init__(
        self,
        policy: HttpPolicy,
        user_agent: str,
        transport: httpx.BaseTransport | None = None,
        sleep: Callable[[float], None] = time.sleep,
    ):
        self.policy = policy
        self._hosts: dict[str, _HostState] = {}
        self._sleep = sleep
        self._client = httpx.Client(
            headers={"User-Agent": user_agent, "Accept-Language": "fr,ar;q=0.8,en;q=0.6"},
            timeout=policy.timeout_s,
            follow_redirects=False,
            transport=transport,
        )

    def close(self) -> None:
        self._client.close()

    def _check_url(self, url: str) -> str:
        parsed = urlparse(url)
        if parsed.scheme != "https":
            raise SourcePolicyViolation(f"only https is allowed: {url}")
        host = (parsed.hostname or "").lower()
        if host not in self.policy.allowed_hosts:
            raise SourcePolicyViolation(f"host {host!r} is not in the source registry allowlist")
        if not self.policy.allow_private_networks:
            _assert_public_host(host)
        return host

    def _robots_allows(self, host: str, url: str, state: _HostState) -> bool:
        if not self.policy.respect_robots:
            return True
        if state.robots is None:
            parser = urllib.robotparser.RobotFileParser()
            try:
                resp = self._client.get(f"https://{host}/robots.txt")
                if resp.status_code in (401, 403) or resp.status_code >= 500:
                    parser.disallow_all = True  # type: ignore[attr-defined]  # RFC 9309: unreachable (5xx) ⇒ assume complete disallow
                    if resp.status_code >= 500:
                        state.robots_error = f"robots.txt returned HTTP {resp.status_code}"
                elif resp.status_code >= 400:
                    parser.allow_all = True  # type: ignore[attr-defined]  # RFC 9309: unavailable (4xx) ⇒ no restrictions
                else:
                    parser.parse(resp.text.splitlines())
            except httpx.HTTPError as exc:
                parser.disallow_all = True  # type: ignore[attr-defined]  # network failure: be conservative
                state.robots_error = f"robots.txt unreachable ({type(exc).__name__}) — check outbound network access"
            state.robots = parser
        agent = str(self._client.headers.get("User-Agent", "*"))
        return state.robots.can_fetch(agent, url)

    def post_form(self, url: str, data: dict[str, str]) -> FetchResult:
        """Form POST for OAuth token endpoints of official APIs (same allowlist, robots and rate limits; no retry)."""
        host = self._check_url(url)
        state = self._hosts.setdefault(host, _HostState())
        if not self._robots_allows(host, url, state):
            if state.robots_error:
                raise RobotsUnavailable(f"{state.robots_error}; not crawling {host}")
            raise RobotsDisallowed(f"robots.txt disallows {url}")
        wait = state.last_request + self.policy.min_interval_s - time.monotonic()
        if wait > 0:
            self._sleep(wait)
        state.last_request = time.monotonic()
        resp = self._client.post(url, data=data, headers={"Accept": "application/json"})
        return FetchResult(url, resp.status_code, resp.content, resp.headers.get("content-type"), None, None)

    def get(
        self,
        url: str,
        *,
        etag: str | None = None,
        last_modified: str | None = None,
        headers: dict[str, str] | None = None,
    ) -> FetchResult:
        host = self._check_url(url)
        state = self._hosts.setdefault(host, _HostState())
        if state.consecutive_failures >= self.policy.breaker_threshold:
            raise CircuitOpen(f"circuit open for {host}")
        if not self._robots_allows(host, url, state):
            if state.robots_error:
                raise RobotsUnavailable(f"{state.robots_error}; not crawling {host}")
            raise RobotsDisallowed(f"robots.txt disallows {url}")
        headers = dict(headers or {})
        if etag:
            headers["If-None-Match"] = etag
        if last_modified:
            headers["If-Modified-Since"] = last_modified
        attempt = 0
        while True:
            wait = state.last_request + self.policy.min_interval_s - time.monotonic()
            if wait > 0:
                self._sleep(wait)
            state.last_request = time.monotonic()
            try:
                resp = self._client.get(url, headers=headers)
                retryable = resp.status_code == 429 or resp.status_code >= 500
            except httpx.TransportError:
                resp, retryable = None, True
            if not retryable and resp is not None:
                state.consecutive_failures = 0
                if len(resp.content) > self.policy.max_bytes:
                    raise SourcePolicyViolation(f"response too large from {url}")
                return FetchResult(
                    url,
                    resp.status_code,
                    resp.content,
                    resp.headers.get("content-type"),
                    resp.headers.get("etag"),
                    resp.headers.get("last-modified"),
                )
            attempt += 1
            if attempt > self.policy.max_retries:
                state.consecutive_failures += 1
                code = resp.status_code if resp is not None else "network"
                raise httpx.HTTPError(f"giving up on {url} after {attempt} attempts ({code})")
            retry_after = resp.headers.get("retry-after") if resp is not None else None
            delay = (
                float(retry_after)
                if retry_after and retry_after.isdigit()
                else (self.policy.backoff_base_s * 2 ** (attempt - 1))
            )
            self._sleep(min(delay, 300))
