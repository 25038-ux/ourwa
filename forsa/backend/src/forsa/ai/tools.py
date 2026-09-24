"""Least-privilege tool permissions for agents (spec §44, §54).

Agents are explicit workflow steps, not free-roaming loops: each has a fixed
tool allowlist, and ``submit_external`` additionally requires an APPROVED human
approval. There is deliberately no generic "http_get" tool — agents never get
unrestricted network access (spec §52).
"""

from __future__ import annotations

from enum import StrEnum

from forsa.kernel.errors import ApprovalRequired, Forbidden


class Tool(StrEnum):
    READ_PUBLIC_SOURCE = "read_public_source"
    READ_COMPANY_DOCUMENT = "read_company_document"
    WRITE_DRAFT = "write_draft"
    CREATE_TASK = "create_task"
    SEND_NOTIFICATION = "send_notification"
    REQUEST_APPROVAL = "request_approval"
    SUBMIT_EXTERNAL = "submit_external"


REQUIRES_APPROVAL = frozenset({Tool.SUBMIT_EXTERNAL})

AGENT_TOOLS: dict[str, frozenset[Tool]] = {
    "opportunity_analyst": frozenset({Tool.READ_PUBLIC_SOURCE}),
    "matching_agent": frozenset({Tool.READ_PUBLIC_SOURCE, Tool.READ_COMPANY_DOCUMENT}),
    "compliance_agent": frozenset({Tool.READ_PUBLIC_SOURCE, Tool.READ_COMPANY_DOCUMENT, Tool.CREATE_TASK}),
    "proposal_agent": frozenset({Tool.READ_PUBLIC_SOURCE, Tool.READ_COMPANY_DOCUMENT, Tool.WRITE_DRAFT}),
    "red_team_agent": frozenset({Tool.READ_PUBLIC_SOURCE, Tool.READ_COMPANY_DOCUMENT}),
    "briefing_agent": frozenset({Tool.SEND_NOTIFICATION, Tool.CREATE_TASK}),
    "submission_step": frozenset({Tool.REQUEST_APPROVAL, Tool.SUBMIT_EXTERNAL}),
}

MAX_AGENT_STEPS = 12  # hard stop — no unbounded recursive agent calls


def authorize_tool(agent: str, tool: Tool, *, approval_status: str | None = None) -> None:
    allowed = AGENT_TOOLS.get(agent)
    if allowed is None or tool not in allowed:
        raise Forbidden(f"agent {agent!r} may not use tool {tool.value!r}")
    if tool in REQUIRES_APPROVAL and approval_status != "APPROVED":
        raise ApprovalRequired(f"tool {tool.value!r} requires an approved human approval request")
