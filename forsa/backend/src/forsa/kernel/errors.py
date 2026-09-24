from __future__ import annotations


class ForsaError(Exception):
    """Base class for expected, user-presentable domain errors."""

    code = "forsa_error"
    status = 400


class NotFound(ForsaError):
    code = "not_found"
    status = 404


class Forbidden(ForsaError):
    code = "forbidden"
    status = 403


class Conflict(ForsaError):
    code = "conflict"
    status = 409


class InvalidTransition(ForsaError):
    code = "invalid_transition"
    status = 409


class ApprovalRequired(ForsaError):
    code = "approval_required"
    status = 403


class SourcePolicyViolation(ForsaError):
    """A connector attempted access that the source registry does not permit."""

    code = "source_policy_violation"
    status = 403
