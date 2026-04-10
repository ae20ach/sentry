from __future__ import annotations

from sentry.dashboards.history import (
    CURRENT_SNAPSHOT_VERSION,
    capture_dashboard_snapshot,
    restore_dashboard_from_snapshot,
)
from sentry.models.dashboard_widget import DashboardWidget
from sentry.testutils.cases import OrganizationDashboardWidgetTestCase

# Pinned v1 snapshot fixture. If this test starts failing after a serializer
# change, add a migration step to migrate_snapshot() before updating this dict.
_SNAPSHOT_V1 = {
    "version": 1,
    "title": "Compatibility Test Dashboard",
    "projects": [],
    "filters": {},
    "permissions": None,
    "widgets": [
        {
            "title": "Errors",
            "displayType": "line",
            "interval": "5m",
            "widgetType": "error-events",
            "limit": None,
            "thresholds": None,
            "layout": None,
            "queries": [
                {
                    "name": "",
                    "fields": ["count()"],
                    "aggregates": ["count()"],
                    "columns": [],
                    "fieldAliases": [],
                    "conditions": "",
                    "orderby": "",
                }
            ],
        }
    ],
}


class CaptureDashboardSnapshotTest(OrganizationDashboardWidgetTestCase):
    def test_snapshot_includes_version(self):
        history = capture_dashboard_snapshot(self.dashboard, user_id=self.user.id)
        assert history.snapshot["version"] == CURRENT_SNAPSHOT_VERSION


class RestoreDashboardFromSnapshotTest(OrganizationDashboardWidgetTestCase):
    def test_restore_v1_snapshot(self):
        request = self.make_request(user=self.user)
        restore_dashboard_from_snapshot(
            dashboard=self.dashboard,
            snapshot=_SNAPSHOT_V1,
            organization=self.organization,
            request=request,
        )
        self.dashboard.refresh_from_db()
        assert self.dashboard.title == "Compatibility Test Dashboard"
        assert DashboardWidget.objects.filter(dashboard=self.dashboard).count() == 1
        widget = DashboardWidget.objects.get(dashboard=self.dashboard)
        assert widget.title == "Errors"
