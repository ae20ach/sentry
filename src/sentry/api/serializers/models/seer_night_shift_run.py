from __future__ import annotations

from typing import Any, TypedDict

from sentry.api.serializers import Serializer, register
from sentry.seer.models.night_shift import SeerNightShiftRun, SeerNightShiftRunIssue


class SeerNightShiftRunIssueResponse(TypedDict):
    id: str
    groupId: str
    action: str
    seerRunId: str | None
    dateAdded: str


class SeerNightShiftRunResponse(TypedDict):
    id: str
    dateAdded: str
    triageStrategy: str
    errorMessage: str | None
    extras: dict[str, Any]
    issues: list[SeerNightShiftRunIssueResponse]


@register(SeerNightShiftRun)
class SeerNightShiftRunSerializer(Serializer):
    def serialize(
        self,
        obj: SeerNightShiftRun,
        attrs: dict[str, Any],
        user: Any,
        **kwargs: Any,
    ) -> SeerNightShiftRunResponse:
        return {
            "id": str(obj.id),
            "dateAdded": obj.date_added.isoformat(),
            "triageStrategy": obj.triage_strategy,
            "errorMessage": obj.error_message,
            "extras": obj.extras or {},
            "issues": [_serialize_issue(i) for i in obj.issues.all()],
        }


def _serialize_issue(issue: SeerNightShiftRunIssue) -> SeerNightShiftRunIssueResponse:
    return {
        "id": str(issue.id),
        "groupId": str(issue.group_id),
        "action": issue.action,
        "seerRunId": issue.seer_run_id,
        "dateAdded": issue.date_added.isoformat(),
    }
