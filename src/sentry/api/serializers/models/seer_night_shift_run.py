from __future__ import annotations

from collections import defaultdict
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
    def get_attrs(
        self, item_list: list[SeerNightShiftRun], user: Any, **kwargs: Any
    ) -> dict[SeerNightShiftRun, dict[str, list[SeerNightShiftRunIssue]]]:
        issues_by_run: dict[int, list[SeerNightShiftRunIssue]] = defaultdict(list)
        for issue in SeerNightShiftRunIssue.objects.filter(run_id__in=[r.id for r in item_list]):
            issues_by_run[issue.run_id].append(issue)

        return {run: {"issues": issues_by_run.get(run.id, [])} for run in item_list}

    def serialize(
        self,
        obj: SeerNightShiftRun,
        attrs: dict[str, list[SeerNightShiftRunIssue]],
        user: Any,
        **kwargs: Any,
    ) -> SeerNightShiftRunResponse:
        return {
            "id": str(obj.id),
            "dateAdded": obj.date_added.isoformat(),
            "triageStrategy": obj.triage_strategy,
            "errorMessage": obj.error_message,
            "extras": obj.extras or {},
            "issues": [_serialize_issue(i) for i in attrs["issues"]],
        }


def _serialize_issue(issue: SeerNightShiftRunIssue) -> SeerNightShiftRunIssueResponse:
    return {
        "id": str(issue.id),
        "groupId": str(issue.group_id),
        "action": issue.action,
        "seerRunId": issue.seer_run_id,
        "dateAdded": issue.date_added.isoformat(),
    }
