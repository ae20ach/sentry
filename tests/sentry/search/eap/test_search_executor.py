from datetime import datetime, timezone

from sentry.api.event_search import SearchFilter, SearchKey, SearchValue
from sentry.search.eap.occurrences.search_executor import search_filters_to_query_string


class TestSearchFiltersToQueryString:
    def test_simple_equality(self):
        filters = [SearchFilter(SearchKey("level"), "=", SearchValue("error"))]
        assert search_filters_to_query_string(filters) == "level:error"

    def test_negation(self):
        filters = [SearchFilter(SearchKey("level"), "!=", SearchValue("error"))]
        assert search_filters_to_query_string(filters) == "!level:error"

    def test_greater_than(self):
        filters = [SearchFilter(SearchKey("exception_count"), ">", SearchValue("5"))]
        assert search_filters_to_query_string(filters) == "exception_count:>5"

    def test_greater_than_or_equal(self):
        filters = [SearchFilter(SearchKey("exception_count"), ">=", SearchValue("5"))]
        assert search_filters_to_query_string(filters) == "exception_count:>=5"

    def test_less_than(self):
        filters = [SearchFilter(SearchKey("exception_count"), "<", SearchValue("5"))]
        assert search_filters_to_query_string(filters) == "exception_count:<5"

    def test_less_than_or_equal(self):
        filters = [SearchFilter(SearchKey("exception_count"), "<=", SearchValue("5"))]
        assert search_filters_to_query_string(filters) == "exception_count:<=5"

    def test_in_list(self):
        filters = [SearchFilter(SearchKey("level"), "IN", SearchValue(["error", "warning"]))]
        assert search_filters_to_query_string(filters) == "level:[error, warning]"

    def test_not_in_list(self):
        filters = [SearchFilter(SearchKey("level"), "NOT IN", SearchValue(["error", "warning"]))]
        assert search_filters_to_query_string(filters) == "!level:[error, warning]"

    def test_wildcard_value(self):
        filters = [SearchFilter(SearchKey("message"), "=", SearchValue("*foo*"))]
        assert search_filters_to_query_string(filters) == "message:*foo*"

    def test_wildcard_prefix(self):
        filters = [SearchFilter(SearchKey("message"), "=", SearchValue("foo*"))]
        assert search_filters_to_query_string(filters) == "message:foo*"

    def test_wildcard_suffix(self):
        filters = [SearchFilter(SearchKey("message"), "=", SearchValue("*foo"))]
        assert search_filters_to_query_string(filters) == "message:*foo"

    def test_has_filter(self):
        # has:user.email is parsed as key=user.email, op=!=, value=""
        filters = [SearchFilter(SearchKey("user.email"), "!=", SearchValue(""))]
        assert search_filters_to_query_string(filters) == "has:user.email"

    def test_not_has_filter(self):
        # !has:user.email is parsed as key=user.email, op==, value=""
        filters = [SearchFilter(SearchKey("user.email"), "=", SearchValue(""))]
        assert search_filters_to_query_string(filters) == "!has:user.email"

    def test_tag_filter(self):
        filters = [SearchFilter(SearchKey("tags[browser]"), "=", SearchValue("chrome"))]
        assert search_filters_to_query_string(filters) == "tags[browser]:chrome"

    def test_value_with_spaces(self):
        filters = [SearchFilter(SearchKey("message"), "=", SearchValue("foo bar baz"))]
        assert search_filters_to_query_string(filters) == 'message:"foo bar baz"'

    def test_value_with_quotes(self):
        filters = [SearchFilter(SearchKey("message"), "=", SearchValue('foo "bar"'))]
        assert search_filters_to_query_string(filters) == 'message:"foo \\"bar\\""'

    def test_value_with_commas(self):
        filters = [SearchFilter(SearchKey("message"), "=", SearchValue("a,b,c"))]
        assert search_filters_to_query_string(filters) == 'message:"a,b,c"'

    def test_numeric_value(self):
        filters = [SearchFilter(SearchKey("exception_count"), "=", SearchValue(42))]
        assert search_filters_to_query_string(filters) == "exception_count:42"

    def test_float_value(self):
        filters = [SearchFilter(SearchKey("exception_count"), ">", SearchValue(3.14))]
        assert search_filters_to_query_string(filters) == "exception_count:>3.14"

    def test_datetime_value(self):
        dt = datetime(2024, 1, 15, 12, 0, 0, tzinfo=timezone.utc)
        filters = [SearchFilter(SearchKey("timestamp"), ">", SearchValue(dt))]
        result = search_filters_to_query_string(filters)
        assert result == "timestamp:>2024-01-15T12:00:00+00:00"

    def test_multiple_filters_joined(self):
        filters = [
            SearchFilter(SearchKey("level"), "=", SearchValue("error")),
            SearchFilter(SearchKey("platform"), "=", SearchValue("python")),
            SearchFilter(SearchKey("message"), "=", SearchValue("fail")),
        ]
        result = search_filters_to_query_string(filters)
        assert result == "level:error platform:python message:fail"

    def test_empty_filters(self):
        assert search_filters_to_query_string([]) == ""

    # --- Skip filters ---

    def test_event_type_skipped(self):
        filters = [SearchFilter(SearchKey("event.type"), "=", SearchValue("error"))]
        assert search_filters_to_query_string(filters) == ""

    def test_times_seen_skipped(self):
        filters = [SearchFilter(SearchKey("times_seen"), ">", SearchValue("100"))]
        assert search_filters_to_query_string(filters) == ""

    def test_last_seen_as_filter_skipped(self):
        dt = datetime(2024, 1, 1, tzinfo=timezone.utc)
        filters = [SearchFilter(SearchKey("last_seen"), ">", SearchValue(dt))]
        assert search_filters_to_query_string(filters) == ""

    def test_user_count_skipped(self):
        filters = [SearchFilter(SearchKey("user_count"), ">", SearchValue("5"))]
        assert search_filters_to_query_string(filters) == ""

    def test_release_stage_skipped(self):
        filters = [SearchFilter(SearchKey("release.stage"), "=", SearchValue("adopted"))]
        assert search_filters_to_query_string(filters) == ""

    def test_release_version_skipped(self):
        filters = [SearchFilter(SearchKey("release.version"), ">", SearchValue("1.0.0"))]
        assert search_filters_to_query_string(filters) == ""

    def test_user_display_skipped(self):
        filters = [SearchFilter(SearchKey("user.display"), "=", SearchValue("john"))]
        assert search_filters_to_query_string(filters) == ""

    def test_team_key_transaction_skipped(self):
        filters = [SearchFilter(SearchKey("team_key_transaction"), "=", SearchValue("1"))]
        assert search_filters_to_query_string(filters) == ""

    def test_transaction_status_skipped(self):
        filters = [SearchFilter(SearchKey("transaction.status"), "=", SearchValue("ok"))]
        assert search_filters_to_query_string(filters) == ""

    def test_skipped_filters_dont_affect_other_filters(self):
        filters = [
            SearchFilter(SearchKey("level"), "=", SearchValue("error")),
            SearchFilter(SearchKey("times_seen"), ">", SearchValue("100")),
            SearchFilter(SearchKey("platform"), "=", SearchValue("python")),
        ]
        result = search_filters_to_query_string(filters)
        assert result == "level:error platform:python"

    # --- Translated filters ---

    def test_error_unhandled_true(self):
        filters = [SearchFilter(SearchKey("error.unhandled"), "=", SearchValue("1"))]
        assert search_filters_to_query_string(filters) == "!error.handled:1"

    def test_error_unhandled_true_bool(self):
        filters = [SearchFilter(SearchKey("error.unhandled"), "=", SearchValue("true"))]
        assert search_filters_to_query_string(filters) == "!error.handled:1"

    def test_error_unhandled_false(self):
        filters = [SearchFilter(SearchKey("error.unhandled"), "=", SearchValue("0"))]
        assert search_filters_to_query_string(filters) == "error.handled:1"

    def test_error_unhandled_negated(self):
        # !error.unhandled:1 → looking for handled errors
        filters = [SearchFilter(SearchKey("error.unhandled"), "!=", SearchValue("1"))]
        assert search_filters_to_query_string(filters) == "error.handled:1"

    def test_error_main_thread_translated(self):
        filters = [SearchFilter(SearchKey("error.main_thread"), "=", SearchValue("1"))]
        assert search_filters_to_query_string(filters) == "exception_main_thread:1"

    def test_error_main_thread_negated(self):
        filters = [SearchFilter(SearchKey("error.main_thread"), "!=", SearchValue("1"))]
        assert search_filters_to_query_string(filters) == "!exception_main_thread:1"

    # --- Pass-through filters (EAP attributes exist) ---

    def test_level_passthrough(self):
        filters = [SearchFilter(SearchKey("level"), "=", SearchValue("warning"))]
        assert search_filters_to_query_string(filters) == "level:warning"

    def test_message_passthrough(self):
        filters = [SearchFilter(SearchKey("message"), "=", SearchValue("connection reset"))]
        assert search_filters_to_query_string(filters) == 'message:"connection reset"'

    def test_platform_passthrough(self):
        filters = [SearchFilter(SearchKey("platform"), "=", SearchValue("javascript"))]
        assert search_filters_to_query_string(filters) == "platform:javascript"

    def test_release_passthrough(self):
        filters = [SearchFilter(SearchKey("release"), "=", SearchValue("1.0.0"))]
        assert search_filters_to_query_string(filters) == "release:1.0.0"

    def test_environment_passthrough(self):
        filters = [SearchFilter(SearchKey("environment"), "=", SearchValue("production"))]
        assert search_filters_to_query_string(filters) == "environment:production"

    def test_error_type_passthrough(self):
        filters = [SearchFilter(SearchKey("error.type"), "=", SearchValue("ValueError"))]
        assert search_filters_to_query_string(filters) == "error.type:ValueError"

    def test_error_handled_passthrough(self):
        filters = [SearchFilter(SearchKey("error.handled"), "=", SearchValue("1"))]
        assert search_filters_to_query_string(filters) == "error.handled:1"

    def test_stack_filename_passthrough(self):
        filters = [SearchFilter(SearchKey("stack.filename"), "=", SearchValue("app.py"))]
        assert search_filters_to_query_string(filters) == "stack.filename:app.py"

    def test_user_email_passthrough(self):
        filters = [SearchFilter(SearchKey("user.email"), "=", SearchValue("foo@bar.com"))]
        assert search_filters_to_query_string(filters) == "user.email:foo@bar.com"

    def test_sdk_name_passthrough(self):
        filters = [SearchFilter(SearchKey("sdk.name"), "=", SearchValue("sentry.python"))]
        assert search_filters_to_query_string(filters) == "sdk.name:sentry.python"

    def test_http_url_passthrough(self):
        filters = [SearchFilter(SearchKey("http.url"), "=", SearchValue("https://example.com"))]
        assert search_filters_to_query_string(filters) == "http.url:https://example.com"

    def test_trace_passthrough(self):
        filters = [
            SearchFilter(SearchKey("trace"), "=", SearchValue("abcdef1234567890abcdef1234567890"))
        ]
        assert search_filters_to_query_string(filters) == "trace:abcdef1234567890abcdef1234567890"

    def test_transaction_passthrough(self):
        filters = [SearchFilter(SearchKey("transaction"), "=", SearchValue("/api/users"))]
        assert search_filters_to_query_string(filters) == "transaction:/api/users"

    def test_dist_passthrough(self):
        filters = [SearchFilter(SearchKey("dist"), "=", SearchValue("abc123"))]
        assert search_filters_to_query_string(filters) == "dist:abc123"

    # --- Complex scenarios ---

    def test_mixed_supported_and_skipped(self):
        """A realistic query mixing supported, skipped, and translated filters."""
        filters = [
            SearchFilter(SearchKey("level"), "=", SearchValue("error")),
            SearchFilter(SearchKey("error.unhandled"), "=", SearchValue("1")),
            SearchFilter(SearchKey("times_seen"), ">", SearchValue("50")),
            SearchFilter(SearchKey("platform"), "IN", SearchValue(["python", "javascript"])),
            SearchFilter(SearchKey("release.version"), ">", SearchValue("2.0.0")),
            SearchFilter(SearchKey("tags[browser]"), "=", SearchValue("chrome")),
        ]
        result = search_filters_to_query_string(filters)
        assert result == (
            "level:error !error.handled:1 platform:[python, javascript] tags[browser]:chrome"
        )

    def test_in_list_with_single_value(self):
        filters = [SearchFilter(SearchKey("level"), "IN", SearchValue(["error"]))]
        assert search_filters_to_query_string(filters) == "level:[error]"

    def test_negated_tag_filter(self):
        filters = [SearchFilter(SearchKey("tags[device]"), "!=", SearchValue("iPhone"))]
        assert search_filters_to_query_string(filters) == "!tags[device]:iPhone"

    def test_wildcard_in_tag(self):
        filters = [SearchFilter(SearchKey("tags[url]"), "=", SearchValue("*example*"))]
        assert search_filters_to_query_string(filters) == "tags[url]:*example*"
