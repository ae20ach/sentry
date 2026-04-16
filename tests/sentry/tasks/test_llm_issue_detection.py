import uuid
from datetime import timedelta
from unittest.mock import Mock, patch

import pytest

from sentry.issues.grouptype import AIDetectedDBGroupType, AIDetectedGeneralGroupType
from sentry.tasks.llm_issue_detection import (
    DetectedIssue,
    create_issue_occurrence_from_detection,
    detect_llm_issues_for_org,
    run_llm_issue_detection,
)
from sentry.tasks.llm_issue_detection.detection import (
    TRANSACTION_BATCH_SIZE,
    TraceMetadataWithSpanCount,
    _get_unprocessed_traces,
    mark_traces_as_processed,
)
from sentry.tasks.llm_issue_detection.trace_data import (
    get_project_top_transaction_traces_for_llm_detection,
    get_valid_trace_ids_by_span_count,
)
from sentry.testutils.cases import APITransactionTestCase, SnubaTestCase, SpanTestCase, TestCase
from sentry.testutils.helpers.datetime import before_now


class TestRunLLMIssueDetection(TestCase):
    @patch("sentry.tasks.llm_issue_detection.detection.CursoredScheduler")
    def test_calls_scheduler_tick(self, mock_scheduler_cls):
        with self.options({"issue-detection.llm-detection.enabled": True}):
            run_llm_issue_detection()

        mock_scheduler_cls.assert_called_once()
        mock_scheduler_cls.return_value.tick.assert_called_once()

    @patch("sentry.tasks.llm_issue_detection.detection.CursoredScheduler")
    def test_skips_when_disabled(self, mock_scheduler_cls):
        with self.options({"issue-detection.llm-detection.enabled": False}):
            run_llm_issue_detection()

        mock_scheduler_cls.assert_not_called()


class TestDetectLLMIssuesForOrg(TestCase):
    @patch("sentry.tasks.llm_issue_detection.detection.mark_traces_as_processed")
    @patch("sentry.tasks.llm_issue_detection.detection._get_unprocessed_traces")
    @patch("sentry.tasks.llm_issue_detection.detection.make_issue_detection_request")
    @patch(
        "sentry.tasks.llm_issue_detection.trace_data.get_project_top_transaction_traces_for_llm_detection"
    )
    @patch("sentry.tasks.llm_issue_detection.detection.Project.objects.filter")
    def test_sends_one_trace_to_seer(
        self,
        mock_project_filter,
        mock_get_transactions,
        mock_seer_request,
        mock_get_unprocessed,
        mock_mark_processed,
    ):
        mock_project_filter.return_value.values_list.return_value = [self.project.id]
        mock_get_transactions.return_value = [
            TraceMetadataWithSpanCount(trace_id="trace_1", span_count=50),
            TraceMetadataWithSpanCount(trace_id="trace_2", span_count=100),
        ]
        mock_get_unprocessed.return_value = {"trace_1", "trace_2"}

        mock_response = Mock()
        mock_response.status = 202
        mock_seer_request.return_value = mock_response

        with self.feature({"organizations:gen-ai-features": True}):
            detect_llm_issues_for_org(self.organization.id)

        assert mock_seer_request.call_count == 1
        seer_request = mock_seer_request.call_args[0][0]
        assert len(seer_request.traces) == 1
        assert seer_request.organization_id == self.organization.id
        mock_mark_processed.assert_called_once()

    @patch("sentry.tasks.llm_issue_detection.detection.mark_traces_as_processed")
    @patch("sentry.tasks.llm_issue_detection.detection.make_issue_detection_request")
    @patch("sentry.tasks.llm_issue_detection.detection._get_unprocessed_traces")
    @patch(
        "sentry.tasks.llm_issue_detection.trace_data.get_project_top_transaction_traces_for_llm_detection"
    )
    @patch("sentry.tasks.llm_issue_detection.detection.Project.objects.filter")
    def test_does_not_mark_processed_on_seer_error(
        self,
        mock_project_filter,
        mock_get_transactions,
        mock_get_unprocessed,
        mock_seer_request,
        mock_mark_processed,
    ):
        mock_project_filter.return_value.values_list.return_value = [self.project.id]
        mock_get_transactions.return_value = [
            TraceMetadataWithSpanCount(trace_id="trace_1", span_count=50),
        ]
        mock_get_unprocessed.return_value = {"trace_1"}

        mock_response = Mock()
        mock_response.status = 500
        mock_response.data = b"Internal Server Error"
        mock_seer_request.return_value = mock_response

        with self.feature({"organizations:gen-ai-features": True}):
            detect_llm_issues_for_org(self.organization.id)

        mock_mark_processed.assert_not_called()


class LLMIssueDetectionTest(TestCase):
    @patch("sentry.tasks.llm_issue_detection.detection.produce_occurrence_to_kafka")
    def test_create_issue_occurrence_from_detection(self, mock_produce_occurrence):
        detected_issue = DetectedIssue(
            title="Slow Database Query",
            explanation="Your application is running out of database connections",
            impact="High - may cause request failures",
            evidence="Connection pool at 95% capacity",
            offender_span_ids=["span_1", "span_2"],
            trace_id="abc123xyz",
            transaction_name="test_transaction",
            verification_reason="Problem is correctly identified",
            group_for_fingerprint="Slow Database Query",
        )

        create_issue_occurrence_from_detection(
            detected_issue=detected_issue,
            project=self.project,
        )

        assert mock_produce_occurrence.called
        occurrence = mock_produce_occurrence.call_args.kwargs["occurrence"]
        assert occurrence.type == AIDetectedGeneralGroupType
        assert occurrence.issue_title == "Slow Database Query"
        assert occurrence.fingerprint == ["llm-detected-slow-database-query"]
        assert occurrence.project_id == self.project.id

    @patch("sentry.tasks.llm_issue_detection.detection.produce_occurrence_to_kafka")
    def test_create_issue_occurrence_maps_group_type(self, mock_produce_occurrence):
        detected_issue = DetectedIssue(
            title="Inefficient Database Queries",
            explanation="Multiple queries in loop",
            impact="Medium",
            evidence="5 queries",
            offender_span_ids=[],
            trace_id="trace456",
            transaction_name="GET /api",
            verification_reason="Verified",
            group_for_fingerprint="N+1 Database Queries",
        )
        create_issue_occurrence_from_detection(
            detected_issue=detected_issue,
            project=self.project,
        )
        occurrence = mock_produce_occurrence.call_args.kwargs["occurrence"]
        assert occurrence.fingerprint == ["llm-detected-n+1-database-queries"]
        assert occurrence.type == AIDetectedDBGroupType


class TestTraceProcessingFunctions:
    @pytest.mark.parametrize(
        ("trace_ids", "mget_return", "expected"),
        [
            (["a", "b", "c"], [None, None, None], {"a", "b", "c"}),
            (["a", "b", "c"], ["1", None, "1"], {"b"}),
            (["a", "b"], ["1", "1"], set()),
            ([], [], set()),
        ],
    )
    @patch("sentry.tasks.llm_issue_detection.detection.redis_clusters")
    def test_get_unprocessed_traces(
        self, mock_redis_clusters: Mock, trace_ids: list, mget_return: list, expected: set
    ) -> None:
        mock_cluster = Mock()
        mock_redis_clusters.get.return_value = mock_cluster
        mock_cluster.mget.return_value = mget_return
        assert _get_unprocessed_traces(trace_ids) == expected

    @pytest.mark.parametrize(
        ("trace_ids", "expected_set_calls"),
        [
            (["trace_123"], 1),
            (["trace_1", "trace_2", "trace_3"], 3),
            ([], 0),
        ],
    )
    @patch("sentry.tasks.llm_issue_detection.detection.redis_clusters")
    def test_mark_traces_as_processed(
        self, mock_redis_clusters: Mock, trace_ids: list[str], expected_set_calls: int
    ) -> None:
        mock_cluster = Mock()
        mock_pipeline = Mock()
        mock_redis_clusters.get.return_value = mock_cluster
        mock_cluster.pipeline.return_value.__enter__ = Mock(return_value=mock_pipeline)
        mock_cluster.pipeline.return_value.__exit__ = Mock(return_value=False)

        mark_traces_as_processed(trace_ids)

        assert mock_pipeline.set.call_count == expected_set_calls
        if expected_set_calls > 0:
            mock_pipeline.execute.assert_called_once()


class TestGetValidTraceIdsBySpanCount:
    @pytest.mark.parametrize(
        ("query_result", "expected"),
        [
            (
                {"data": [{"trace": "a", "count()": 50}, {"trace": "b", "count()": 100}]},
                {"a": 50, "b": 100},
            ),
            (
                {"data": [{"trace": "a", "count()": 10}, {"trace": "b", "count()": 50}]},
                {"b": 50},
            ),
            (
                {"data": [{"trace": "a", "count()": 50}, {"trace": "b", "count()": 600}]},
                {"a": 50},
            ),
            ({"data": []}, {}),
        ],
    )
    @patch("sentry.tasks.llm_issue_detection.trace_data.Spans.run_table_query")
    def test_filters_by_span_count(
        self, mock_spans_query: Mock, query_result: dict, expected: dict[str, int]
    ) -> None:
        mock_spans_query.return_value = query_result
        result = get_valid_trace_ids_by_span_count(["a", "b", "c", "d"], Mock(), Mock())
        assert result == expected


class TestGetProjectTopTransactionTracesForLLMDetection(
    APITransactionTestCase, SnubaTestCase, SpanTestCase
):
    def setUp(self) -> None:
        super().setUp()
        self.ten_mins_ago = before_now(minutes=10)

    @patch("sentry.tasks.llm_issue_detection.trace_data.get_valid_trace_ids_by_span_count")
    def test_returns_deduped_transaction_traces(self, mock_span_count) -> None:
        mock_span_count.side_effect = lambda trace_ids, *args: {tid: 50 for tid in trace_ids}

        trace_id_1 = uuid.uuid4().hex
        span1 = self.create_span(
            {
                "description": "GET /api/users/123456",
                "sentry_tags": {"transaction": "GET /api/users/123456"},
                "trace_id": trace_id_1,
                "is_segment": True,
                "exclusive_time_ms": 100,
                "duration_ms": 100,
            },
            start_ts=self.ten_mins_ago,
        )

        trace_id_2 = uuid.uuid4().hex
        span2 = self.create_span(
            {
                "description": "GET /api/users/789012",
                "sentry_tags": {"transaction": "GET /api/users/789012"},
                "trace_id": trace_id_2,
                "is_segment": True,
                "exclusive_time_ms": 200,
                "duration_ms": 200,
            },
            start_ts=self.ten_mins_ago + timedelta(seconds=1),
        )

        trace_id_3 = uuid.uuid4().hex
        span3 = self.create_span(
            {
                "description": "POST /api/orders",
                "sentry_tags": {"transaction": "POST /api/orders"},
                "trace_id": trace_id_3,
                "is_segment": True,
                "exclusive_time_ms": 150,
                "duration_ms": 150,
            },
            start_ts=self.ten_mins_ago + timedelta(seconds=2),
        )

        self.store_spans([span1, span2, span3])

        evidence_traces = get_project_top_transaction_traces_for_llm_detection(
            self.project.id, limit=TRANSACTION_BATCH_SIZE, start_time_delta_minutes=30
        )

        assert len(evidence_traces) == 2
        assert evidence_traces[0].trace_id == trace_id_2
        assert evidence_traces[1].trace_id == trace_id_3
