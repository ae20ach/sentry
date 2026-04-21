from unittest.mock import patch

from django.utils import timezone

from sentry.models.group import Group
from sentry.seer.autofix.constants import AutofixAutomationTuningSettings
from sentry.seer.autofix.utils import AutofixStoppingPoint
from sentry.seer.explorer.client_models import Artifact, MemoryBlock, Message, SeerRunState
from sentry.seer.models.night_shift import SeerNightShiftRun, SeerNightShiftRunIssue
from sentry.seer.models.project_repository import SeerProjectRepository
from sentry.tasks.seer.night_shift.cron import (
    _get_eligible_projects,
    run_night_shift_for_org,
    schedule_night_shift,
)
from sentry.tasks.seer.night_shift.simple_triage import fixability_score_strategy
from sentry.testutils.cases import SnubaTestCase, TestCase
from sentry.testutils.helpers.datetime import before_now
from sentry.testutils.pytest.fixtures import django_db_all


class FakeExplorerClient:
    """Stub SeerExplorerClient that returns canned triage verdicts."""

    def __init__(self, group_ids: list[int], action: str = "autofix"):
        verdicts = [{"group_id": gid, "action": action, "reason": "test"} for gid in group_ids]
        artifact = Artifact(key="triage_verdicts", data={"verdicts": verdicts}, reason="test")
        self._state = SeerRunState(
            run_id=1,
            blocks=[
                MemoryBlock(
                    id="test-block",
                    message=Message(role="assistant"),
                    timestamp="2025-01-01T00:00:00",
                    artifacts=[artifact],
                ),
            ],
            status="completed",
            updated_at="2025-01-01T00:00:00",
        )

    def start_run(self, **kwargs):
        return 1

    def get_run(self, run_id, **kwargs):
        return self._state


@django_db_all
class TestScheduleNightShift(TestCase):
    def test_disabled_by_option(self) -> None:
        with (
            self.options({"seer.night_shift.enable": False}),
            patch("sentry.tasks.seer.night_shift.cron.run_night_shift_for_org") as mock_worker,
        ):
            schedule_night_shift()
            mock_worker.apply_async.assert_not_called()

    def test_dispatches_eligible_orgs(self) -> None:
        org = self.create_organization()

        with (
            self.options({"seer.night_shift.enable": True}),
            self.feature(
                {
                    "organizations:seer-night-shift": [org.slug],
                    "organizations:gen-ai-features": [org.slug],
                    "organizations:seat-based-seer-enabled": [org.slug],
                }
            ),
            patch("sentry.tasks.seer.night_shift.cron.run_night_shift_for_org") as mock_worker,
        ):
            schedule_night_shift()
            mock_worker.apply_async.assert_called_once()
            assert mock_worker.apply_async.call_args.kwargs["args"] == [org.id]

    def test_skips_orgs_without_seat_based_seer(self) -> None:
        org = self.create_organization()

        with (
            self.options({"seer.night_shift.enable": True}),
            self.feature(
                {
                    "organizations:seer-night-shift": [org.slug],
                    "organizations:gen-ai-features": [org.slug],
                    # seat-based-seer-enabled intentionally omitted
                }
            ),
            patch("sentry.tasks.seer.night_shift.cron.run_night_shift_for_org") as mock_worker,
        ):
            schedule_night_shift()
            mock_worker.apply_async.assert_not_called()

    def test_skips_ineligible_orgs(self) -> None:
        self.create_organization()

        with (
            self.options({"seer.night_shift.enable": True}),
            patch("sentry.tasks.seer.night_shift.cron.run_night_shift_for_org") as mock_worker,
        ):
            schedule_night_shift()
            mock_worker.apply_async.assert_not_called()

    def test_skips_orgs_with_hidden_ai(self) -> None:
        org = self.create_organization()
        org.update_option("sentry:hide_ai_features", True)

        with (
            self.options({"seer.night_shift.enable": True}),
            self.feature(
                {
                    "organizations:seer-night-shift": [org.slug],
                    "organizations:gen-ai-features": [org.slug],
                    "organizations:seat-based-seer-enabled": [org.slug],
                }
            ),
            patch("sentry.tasks.seer.night_shift.cron.run_night_shift_for_org") as mock_worker,
        ):
            schedule_night_shift()
            mock_worker.apply_async.assert_not_called()


@django_db_all
class TestGetEligibleProjects(TestCase):
    def test_filters_by_automation_and_repos(self) -> None:
        org = self.create_organization()

        # Eligible: automation on + connected repo
        eligible = self.create_project(organization=org)
        eligible.update_option(
            "sentry:autofix_automation_tuning", AutofixAutomationTuningSettings.MEDIUM
        )
        repo = self.create_repo(project=eligible, provider="github", name="owner/eligible-repo")
        SeerProjectRepository.objects.create(project=eligible, repository=repo)

        # Automation off (even with repo)
        off = self.create_project(organization=org)
        off.update_option("sentry:autofix_automation_tuning", AutofixAutomationTuningSettings.OFF)
        repo2 = self.create_repo(project=off, provider="github", name="owner/off-repo")
        SeerProjectRepository.objects.create(project=off, repository=repo2)

        # No connected repo
        self.create_project(organization=org)

        with self.feature(
            [
                "organizations:seer-project-settings-read-from-sentry",
                "projects:seer-night-shift",
            ]
        ):
            projects, preferences = _get_eligible_projects(org)
            assert projects == [eligible]
            assert eligible.id in preferences

    def test_filters_by_project_flag_disabled(self) -> None:
        org = self.create_organization()

        project = self.create_project(organization=org)
        project.update_option(
            "sentry:autofix_automation_tuning", AutofixAutomationTuningSettings.MEDIUM
        )
        repo = self.create_repo(project=project, provider="github", name="owner/repo")
        SeerProjectRepository.objects.create(project=project, repository=repo)

        with self.feature(
            {
                "organizations:seer-project-settings-read-from-sentry": True,
                "projects:seer-night-shift": False,
            }
        ):
            projects, _ = _get_eligible_projects(org)
            assert projects == []


@django_db_all
class TestRunNightShiftForOrg(TestCase, SnubaTestCase):
    reset_snuba_data = False

    def _make_eligible(self, project):
        project.update_option(
            "sentry:autofix_automation_tuning", AutofixAutomationTuningSettings.MEDIUM
        )
        repo = self.create_repo(project=project, provider="github", name=f"owner/{project.slug}")
        SeerProjectRepository.objects.create(project=project, repository=repo)

    def _store_event_and_update_group(self, project, fingerprint, **group_attrs):
        event = self.store_event(
            data={
                "fingerprint": [fingerprint],
                "timestamp": before_now(hours=1).isoformat(),
                "environment": "production",
            },
            project_id=project.id,
        )
        Group.objects.filter(id=event.group_id).update(**group_attrs)
        return Group.objects.get(id=event.group_id)

    def test_nonexistent_org(self) -> None:
        with patch("sentry.tasks.seer.night_shift.cron.logger") as mock_logger:
            run_night_shift_for_org(999999999)
            mock_logger.info.assert_not_called()

    def test_no_eligible_projects(self) -> None:
        org = self.create_organization()
        self.create_project(organization=org)

        with (
            self.feature(
                [
                    "organizations:seer-project-settings-read-from-sentry",
                    "projects:seer-night-shift",
                ]
            ),
            patch("sentry.tasks.seer.night_shift.cron.logger") as mock_logger,
        ):
            run_night_shift_for_org(org.id)
            mock_logger.info.assert_called_once()
            assert mock_logger.info.call_args.args[0] == "night_shift.no_eligible_projects"

        run = SeerNightShiftRun.objects.get(organization=org)
        assert run.error_message is None
        assert not SeerNightShiftRunIssue.objects.filter(run=run).exists()

    def test_eligible_projects_error_records_error_message(self) -> None:
        org = self.create_organization()
        self.create_project(organization=org)

        with (
            self.feature(
                [
                    "organizations:seer-project-settings-read-from-sentry",
                    "projects:seer-night-shift",
                ]
            ),
            patch(
                "sentry.tasks.seer.night_shift.cron._get_eligible_projects",
                side_effect=RuntimeError("boom"),
            ),
        ):
            run_night_shift_for_org(org.id)

        run = SeerNightShiftRun.objects.get(organization=org)
        assert run.error_message == "Failed to get eligible projects"
        assert not SeerNightShiftRunIssue.objects.filter(run=run).exists()

    def test_selects_candidates_and_skips_triggered(self) -> None:
        org = self.create_organization()
        project = self.create_project(organization=org)
        self._make_eligible(project)

        high_fix = self._store_event_and_update_group(
            project, "high-fix", seer_fixability_score=0.9, times_seen=5
        )
        low_fix = self._store_event_and_update_group(
            project, "low-fix", seer_fixability_score=0.2, times_seen=100
        )
        # Already triggered — should be excluded
        self._store_event_and_update_group(
            project,
            "triggered",
            seer_fixability_score=0.95,
            seer_autofix_last_triggered=timezone.now(),
        )

        fake_client = FakeExplorerClient([high_fix.id, low_fix.id])
        with (
            self.feature(
                [
                    "organizations:seer-project-settings-read-from-sentry",
                    "projects:seer-night-shift",
                ]
            ),
            patch(
                "sentry.tasks.seer.night_shift.agentic_triage.SeerExplorerClient",
                return_value=fake_client,
            ),
            patch(
                "sentry.tasks.seer.night_shift.cron.trigger_autofix_explorer",
                return_value=1,
            ),
            patch("sentry.tasks.seer.night_shift.cron.logger") as mock_logger,
        ):
            run_night_shift_for_org(org.id)

            call_extra = mock_logger.info.call_args.kwargs["extra"]
            assert call_extra["num_candidates"] == 2
            candidates = call_extra["candidates"]
            assert candidates[0]["group_id"] == high_fix.id
            assert candidates[1]["group_id"] == low_fix.id

        run = SeerNightShiftRun.objects.get(organization=org)
        assert run.triage_strategy == "agentic_triage"
        assert run.error_message is None
        assert run.extras == {"agent_run_id": 1}

        issues = list(SeerNightShiftRunIssue.objects.filter(run=run))
        assert len(issues) == 2
        issue_group_ids = {i.group_id for i in issues}
        assert issue_group_ids == {high_fix.id, low_fix.id}

    def test_global_ranking_across_projects(self) -> None:
        org = self.create_organization()
        project_a = self.create_project(organization=org)
        project_b = self.create_project(organization=org)
        self._make_eligible(project_a)
        self._make_eligible(project_b)

        low_group = self._store_event_and_update_group(
            project_a, "low-group", seer_fixability_score=0.3
        )
        high_group = self._store_event_and_update_group(
            project_b, "high-group", seer_fixability_score=0.95
        )

        fake_client = FakeExplorerClient([high_group.id, low_group.id])
        with (
            self.feature(
                [
                    "organizations:seer-project-settings-read-from-sentry",
                    "projects:seer-night-shift",
                ]
            ),
            patch(
                "sentry.tasks.seer.night_shift.agentic_triage.SeerExplorerClient",
                return_value=fake_client,
            ),
            patch("sentry.tasks.seer.night_shift.cron.logger") as mock_logger,
        ):
            run_night_shift_for_org(org.id)

            candidates = mock_logger.info.call_args.kwargs["extra"]["candidates"]
            assert candidates[0]["group_id"] == high_group.id
            assert candidates[1]["group_id"] == low_group.id

    def test_triage_error_records_error_message(self) -> None:
        org = self.create_organization()
        project = self.create_project(organization=org)
        self._make_eligible(project)

        self._store_event_and_update_group(
            project, "fixable", seer_fixability_score=0.9, times_seen=5
        )

        with (
            self.feature(
                [
                    "organizations:seer-project-settings-read-from-sentry",
                    "projects:seer-night-shift",
                ]
            ),
            patch(
                "sentry.tasks.seer.night_shift.cron.agentic_triage_strategy",
                side_effect=RuntimeError("boom"),
            ),
        ):
            run_night_shift_for_org(org.id)

        run = SeerNightShiftRun.objects.get(organization=org)
        assert run.error_message == "Night shift run failed"
        assert not SeerNightShiftRunIssue.objects.filter(run=run).exists()

    def test_explorer_triage_error_propagates_to_run(self) -> None:
        org = self.create_organization()
        project = self.create_project(organization=org)
        self._make_eligible(project)

        self._store_event_and_update_group(
            project, "fixable", seer_fixability_score=0.9, times_seen=5
        )

        mock_client = FakeExplorerClient([])
        mock_client.start_run = lambda **kwargs: (_ for _ in ()).throw(
            RuntimeError("explorer down")
        )
        with (
            self.feature(
                [
                    "organizations:seer-project-settings-read-from-sentry",
                    "projects:seer-night-shift",
                ]
            ),
            patch(
                "sentry.tasks.seer.night_shift.agentic_triage.SeerExplorerClient",
                return_value=mock_client,
            ),
        ):
            run_night_shift_for_org(org.id)

        run = SeerNightShiftRun.objects.get(organization=org)
        assert run.error_message == "Night shift run failed"
        assert not SeerNightShiftRunIssue.objects.filter(run=run).exists()

    def test_triggers_autofix_for_fixable_candidates(self) -> None:
        org = self.create_organization()
        project = self.create_project(organization=org)
        self._make_eligible(project)

        group = self._store_event_and_update_group(
            project, "fixable", seer_fixability_score=0.9, times_seen=5
        )

        fake_client = FakeExplorerClient([group.id], action="autofix")
        with (
            self.feature(
                [
                    "organizations:seer-project-settings-read-from-sentry",
                    "projects:seer-night-shift",
                ]
            ),
            patch(
                "sentry.tasks.seer.night_shift.agentic_triage.SeerExplorerClient",
                return_value=fake_client,
            ),
            patch(
                "sentry.tasks.seer.night_shift.cron.trigger_autofix_explorer",
                return_value=42,
            ) as mock_trigger,
        ):
            run_night_shift_for_org(org.id)

            mock_trigger.assert_called_once()
            call_kwargs = mock_trigger.call_args.kwargs
            assert call_kwargs["group"].id == group.id
            # AUTOFIX triage suggests OPEN_PR; project default automated_run_stopping_point
            # is CODE_CHANGES, so the clamped stopping point is the more conservative one.
            assert call_kwargs["stopping_point"] == AutofixStoppingPoint.CODE_CHANGES

        run = SeerNightShiftRun.objects.get(organization=org)
        issue = SeerNightShiftRunIssue.objects.get(run=run, group_id=group.id)
        assert issue.seer_run_id == "42"

    def test_triggers_autofix_for_root_cause_only_candidates(self) -> None:
        org = self.create_organization()
        project = self.create_project(organization=org)
        self._make_eligible(project)

        group = self._store_event_and_update_group(
            project, "root-cause", seer_fixability_score=0.9, times_seen=5
        )

        fake_client = FakeExplorerClient([group.id], action="root_cause_only")
        with (
            self.feature(
                [
                    "organizations:seer-project-settings-read-from-sentry",
                    "projects:seer-night-shift",
                ]
            ),
            patch(
                "sentry.tasks.seer.night_shift.agentic_triage.SeerExplorerClient",
                return_value=fake_client,
            ),
            patch(
                "sentry.tasks.seer.night_shift.cron.trigger_autofix_explorer",
                return_value=99,
            ) as mock_trigger,
        ):
            run_night_shift_for_org(org.id)

            mock_trigger.assert_called_once()
            assert (
                mock_trigger.call_args.kwargs["stopping_point"] == AutofixStoppingPoint.ROOT_CAUSE
            )

        run = SeerNightShiftRun.objects.get(organization=org)
        issue = SeerNightShiftRunIssue.objects.get(run=run, group_id=group.id)
        assert issue.seer_run_id == "99"

    def test_dry_run_skips_autofix(self) -> None:
        org = self.create_organization()
        project = self.create_project(organization=org)
        self._make_eligible(project)

        group = self._store_event_and_update_group(
            project, "fixable", seer_fixability_score=0.9, times_seen=5
        )

        fake_client = FakeExplorerClient([group.id], action="autofix")
        with (
            self.feature(
                [
                    "organizations:seer-project-settings-read-from-sentry",
                    "projects:seer-night-shift",
                ]
            ),
            patch(
                "sentry.tasks.seer.night_shift.agentic_triage.SeerExplorerClient",
                return_value=fake_client,
            ),
            patch(
                "sentry.tasks.seer.night_shift.cron.trigger_autofix_explorer",
            ) as mock_trigger,
            patch("sentry.tasks.seer.night_shift.cron.logger") as mock_logger,
        ):
            run_night_shift_for_org(org.id, dry_run=True)

            mock_trigger.assert_not_called()
            log_calls = [call.args[0] for call in mock_logger.info.call_args_list]
            assert "night_shift.dry_run_completed" in log_calls

        # Dry runs don't perform any Seer work, so no issue rows are written.
        run = SeerNightShiftRun.objects.get(organization=org)
        assert SeerNightShiftRunIssue.objects.filter(run=run).count() == 0

    def test_skips_autofix_for_skip_candidates(self) -> None:
        org = self.create_organization()
        project = self.create_project(organization=org)
        self._make_eligible(project)

        group = self._store_event_and_update_group(
            project, "skip-me", seer_fixability_score=0.9, times_seen=5
        )

        fake_client = FakeExplorerClient([group.id], action="skip")
        with (
            self.feature(
                [
                    "organizations:seer-project-settings-read-from-sentry",
                    "projects:seer-night-shift",
                ]
            ),
            patch(
                "sentry.tasks.seer.night_shift.agentic_triage.SeerExplorerClient",
                return_value=fake_client,
            ),
            patch(
                "sentry.tasks.seer.night_shift.cron.trigger_autofix_explorer",
            ) as mock_trigger,
            patch("sentry.tasks.seer.night_shift.cron.logger") as mock_logger,
        ):
            run_night_shift_for_org(org.id)

            mock_trigger.assert_not_called()
            log_calls = [call.args[0] for call in mock_logger.info.call_args_list]
            assert "night_shift.no_fixable_candidates" in log_calls

        # No fixable candidates, so no issue rows are written.
        run = SeerNightShiftRun.objects.get(organization=org)
        assert not SeerNightShiftRunIssue.objects.filter(run=run).exists()

    def test_skips_autofix_when_no_seer_quota(self) -> None:
        org = self.create_organization()
        project = self.create_project(organization=org)
        self._make_eligible(project)

        self._store_event_and_update_group(
            project, "fixable", seer_fixability_score=0.9, times_seen=5
        )

        with (
            self.feature(
                [
                    "organizations:seer-project-settings-read-from-sentry",
                    "projects:seer-night-shift",
                ]
            ),
            patch(
                "sentry.tasks.seer.night_shift.cron.quotas.backend.check_seer_quota",
                return_value=False,
            ),
            patch("sentry.tasks.seer.night_shift.cron.agentic_triage_strategy") as mock_triage,
            patch(
                "sentry.tasks.seer.night_shift.cron.trigger_autofix_explorer",
            ) as mock_trigger,
        ):
            run_night_shift_for_org(org.id)

            # Triage and trigger are both skipped when the org has no quota.
            mock_triage.assert_not_called()
            mock_trigger.assert_not_called()

        run = SeerNightShiftRun.objects.get(organization=org)
        assert run.error_message == "No Seer quota available"
        assert not SeerNightShiftRunIssue.objects.filter(run=run).exists()

    def test_skips_issue_row_when_trigger_returns_none(self) -> None:
        org = self.create_organization()
        project = self.create_project(organization=org)
        self._make_eligible(project)

        group = self._store_event_and_update_group(
            project, "fixable", seer_fixability_score=0.9, times_seen=5
        )

        fake_client = FakeExplorerClient([group.id], action="autofix")
        with (
            self.feature(
                [
                    "organizations:seer-project-settings-read-from-sentry",
                    "projects:seer-night-shift",
                ]
            ),
            patch(
                "sentry.tasks.seer.night_shift.agentic_triage.SeerExplorerClient",
                return_value=fake_client,
            ),
            patch(
                "sentry.tasks.seer.night_shift.cron.trigger_autofix_explorer",
                return_value=None,
            ),
            patch("sentry.tasks.seer.night_shift.cron.logger") as mock_logger,
        ):
            run_night_shift_for_org(org.id)

            warn_calls = [call.args[0] for call in mock_logger.warning.call_args_list]
            assert "night_shift.autofix_trigger_returned_none" in warn_calls

        # Trigger failure leaves the debug signal in logs only; no dashboard row.
        run = SeerNightShiftRun.objects.get(organization=org)
        assert not SeerNightShiftRunIssue.objects.filter(run=run).exists()

    def test_skips_issue_row_when_trigger_raises(self) -> None:
        org = self.create_organization()
        project = self.create_project(organization=org)
        self._make_eligible(project)

        group = self._store_event_and_update_group(
            project, "fixable", seer_fixability_score=0.9, times_seen=5
        )

        fake_client = FakeExplorerClient([group.id], action="autofix")
        with (
            self.feature(
                [
                    "organizations:seer-project-settings-read-from-sentry",
                    "projects:seer-night-shift",
                ]
            ),
            patch(
                "sentry.tasks.seer.night_shift.agentic_triage.SeerExplorerClient",
                return_value=fake_client,
            ),
            patch(
                "sentry.tasks.seer.night_shift.cron.trigger_autofix_explorer",
                side_effect=RuntimeError("explorer crash"),
            ),
            patch("sentry.tasks.seer.night_shift.cron.logger") as mock_logger,
        ):
            run_night_shift_for_org(org.id)

            exception_calls = [call.args[0] for call in mock_logger.exception.call_args_list]
            assert "night_shift.autofix_trigger_failed" in exception_calls

        run = SeerNightShiftRun.objects.get(organization=org)
        assert not SeerNightShiftRunIssue.objects.filter(run=run).exists()

    def test_empty_candidates_creates_run_with_no_issues(self) -> None:
        org = self.create_organization()
        project = self.create_project(organization=org)
        self._make_eligible(project)

        self._store_event_and_update_group(
            project, "fixable", seer_fixability_score=0.9, times_seen=5
        )

        with (
            self.feature(
                [
                    "organizations:seer-project-settings-read-from-sentry",
                    "projects:seer-night-shift",
                ]
            ),
            patch(
                "sentry.tasks.seer.night_shift.cron.agentic_triage_strategy",
                return_value=([], None),
            ),
        ):
            run_night_shift_for_org(org.id)

        run = SeerNightShiftRun.objects.get(organization=org)
        assert run.error_message is None
        assert not SeerNightShiftRunIssue.objects.filter(run=run).exists()


@django_db_all
class TestFixabilityScoreStrategy(TestCase, SnubaTestCase):
    reset_snuba_data = False

    def _store_event_and_update_group(self, project, fingerprint, **group_attrs):
        event = self.store_event(
            data={
                "fingerprint": [fingerprint],
                "timestamp": before_now(hours=1).isoformat(),
                "environment": "production",
            },
            project_id=project.id,
        )
        Group.objects.filter(id=event.group_id).update(**group_attrs)
        return Group.objects.get(id=event.group_id)

    def test_ranks_and_captures_signals(self) -> None:
        project = self.create_project()
        high = self._store_event_and_update_group(
            project, "high", seer_fixability_score=0.9, times_seen=5, priority=75
        )
        low = self._store_event_and_update_group(
            project, "low", seer_fixability_score=0.2, times_seen=500
        )
        for i in range(3):
            self._store_event_and_update_group(
                project, f"null-{i}", seer_fixability_score=None, times_seen=100
            )

        result = fixability_score_strategy([project], max_candidates=10)

        assert result[0].group.id == high.id
        assert result[0].fixability == 0.9
        assert result[0].times_seen == 5
        assert result[0].severity == 1.0
        assert result[1].group.id == low.id
