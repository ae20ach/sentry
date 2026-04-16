from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock, patch

import orjson
from django.urls import reverse

from sentry.issues.endpoints.organization_issues_with_supergroups import _blend_rows
from sentry.testutils.cases import APITestCase, SnubaTestCase
from sentry.testutils.helpers.datetime import before_now


def _supergroup(sg_id: int, group_ids: list[int]) -> dict[str, Any]:
    return {
        "id": sg_id,
        "title": f"sg-{sg_id}",
        "summary": "",
        "error_type": "",
        "code_area": "",
        "group_ids": group_ids,
        "project_ids": [],
        "created_at": "2026-01-01T00:00:00Z",
        "updated_at": "2026-01-01T00:00:00Z",
    }


# --- unit tests for the pure blend function ---


def test_blend_rows_returns_issue_rows_when_seer_unavailable() -> None:
    groups = [{"id": "1"}, {"id": "2"}]
    assert _blend_rows(groups, None) == [
        {"type": "issue", "group": {"id": "1"}},
        {"type": "issue", "group": {"id": "2"}},
    ]


def test_blend_rows_treats_single_member_supergroup_as_plain_issue() -> None:
    sg = _supergroup(7, [1])
    assert _blend_rows([{"id": "1"}], {"data": [sg]}) == [
        {"type": "issue", "group": {"id": "1"}},
    ]


def test_blend_rows_renders_solo_visible_member_as_issue_even_when_cluster_has_siblings() -> None:
    # Supergroup has 3 total members [1, 2, 3] but only group 1 is on this page
    # (e.g., groups 2 and 3 got filtered out by ?status=unresolved).
    # Row should be an issue, not a degenerate supergroup with one child.
    sg = _supergroup(42, [1, 2, 3])
    assert _blend_rows([{"id": "1"}], {"data": [sg]}) == [
        {"type": "issue", "group": {"id": "1"}},
    ]


def test_blend_rows_collapses_multi_member_supergroup() -> None:
    sg = _supergroup(42, [1, 2])
    rows = _blend_rows(
        [{"id": "1"}, {"id": "2"}, {"id": "3"}],
        {"data": [sg]},
    )
    assert rows == [
        {"type": "supergroup", "supergroup": sg, "matchingGroups": [{"id": "1"}, {"id": "2"}]},
        {"type": "issue", "group": {"id": "3"}},
    ]


def test_blend_rows_positions_supergroup_at_first_matching_member() -> None:
    # Stream order: 3 (unrelated), then 1 + 2 in the same supergroup.
    # The supergroup row should sit at position 1, where group 1 first appears.
    sg = _supergroup(42, [1, 2])
    rows = _blend_rows(
        [{"id": "3"}, {"id": "1"}, {"id": "2"}],
        {"data": [sg]},
    )
    assert rows == [
        {"type": "issue", "group": {"id": "3"}},
        {"type": "supergroup", "supergroup": sg, "matchingGroups": [{"id": "1"}, {"id": "2"}]},
    ]


def test_blend_rows_folds_interleaved_members_into_same_row() -> None:
    # Supergroup contains 1 and 3; 2 is standalone between them.
    sg = _supergroup(42, [1, 3])
    rows = _blend_rows(
        [{"id": "1"}, {"id": "2"}, {"id": "3"}],
        {"data": [sg]},
    )
    assert rows == [
        {"type": "supergroup", "supergroup": sg, "matchingGroups": [{"id": "1"}, {"id": "3"}]},
        {"type": "issue", "group": {"id": "2"}},
    ]


def test_blend_rows_handles_multiple_supergroups() -> None:
    sg_a = _supergroup(1, [10, 20])
    sg_b = _supergroup(2, [30, 40])
    rows = _blend_rows(
        [{"id": "10"}, {"id": "30"}, {"id": "20"}, {"id": "40"}],
        {"data": [sg_a, sg_b]},
    )
    assert rows == [
        {"type": "supergroup", "supergroup": sg_a, "matchingGroups": [{"id": "10"}, {"id": "20"}]},
        {"type": "supergroup", "supergroup": sg_b, "matchingGroups": [{"id": "30"}, {"id": "40"}]},
    ]


# --- integration tests for the endpoint ---


def _seer_response(data: dict[str, Any]) -> MagicMock:
    response = MagicMock()
    response.status = 200
    response.data = orjson.dumps(data)
    return response


def _seer_error(status: int = 500) -> MagicMock:
    response = MagicMock()
    response.status = status
    response.data = b""
    return response


class OrganizationIssuesWithSupergroupsEndpointTest(APITestCase, SnubaTestCase):
    endpoint = "sentry-api-0-organization-issues-with-supergroups"

    def setUp(self) -> None:
        super().setUp()
        self.login_as(user=self.user)
        self.url = reverse(self.endpoint, args=(self.organization.slug,))

    def _store(self, fingerprint: str) -> Any:
        return self.store_event(
            data={
                "fingerprint": [fingerprint],
                "timestamp": before_now(seconds=10).isoformat(),
            },
            project_id=self.project.id,
        )

    def test_feature_flag_off_returns_403(self) -> None:
        assert self.client.get(self.url).status_code == 403

    @patch("sentry.seer.supergroups.by_group.make_supergroups_get_by_group_ids_request")
    def test_returns_rows_for_stored_events(self, mock_seer: MagicMock) -> None:
        mock_seer.return_value = _seer_response({"data": []})
        event = self._store("solo")

        with self.feature("organizations:top-issues-ui"):
            response = self.client.get(self.url)

        assert response.status_code == 200
        rows = response.json()
        assert len(rows) == 1
        assert rows[0]["type"] == "issue"
        assert rows[0]["group"]["id"] == str(event.group_id)

    @patch("sentry.seer.supergroups.by_group.make_supergroups_get_by_group_ids_request")
    def test_overfetches_to_offset_collapse(self, mock_seer: MagicMock) -> None:
        # Client asks for limit=2 but has 3 events; without the 2x overfetch the
        # parent would fetch only 2 raw groups and collapse would starve the page.
        a = self._store("a")
        b = self._store("b")
        c = self._store("c")
        mock_seer.return_value = _seer_response(
            {"data": [_supergroup(99, [a.group_id, b.group_id])]}
        )

        with self.feature("organizations:top-issues-ui"):
            response = self.client.get(self.url + "?limit=2")

        assert response.status_code == 200
        rows = response.json()
        assert len(rows) == 2
        sg_row = next(r for r in rows if r["type"] == "supergroup")
        assert {g["id"] for g in sg_row["matchingGroups"]} == {str(a.group_id), str(b.group_id)}
        assert next(r for r in rows if r["type"] == "issue")["group"]["id"] == str(c.group_id)

    @patch("sentry.seer.supergroups.by_group.make_supergroups_get_by_group_ids_request")
    def test_seer_failure_falls_back_to_plain_issue_rows(self, mock_seer: MagicMock) -> None:
        mock_seer.return_value = _seer_error(503)
        event = self._store("fallback")

        with self.feature("organizations:top-issues-ui"):
            response = self.client.get(self.url)

        assert response.status_code == 200
        rows = response.json()
        assert len(rows) == 1
        assert rows[0]["type"] == "issue"
        assert rows[0]["group"]["id"] == str(event.group_id)
