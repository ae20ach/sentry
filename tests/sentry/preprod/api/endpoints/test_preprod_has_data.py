from __future__ import annotations

from datetime import timedelta

from django.utils import timezone

from sentry.preprod.models import PreprodArtifact
from sentry.preprod.snapshots.models import PreprodSnapshotMetrics
from sentry.testutils.cases import APITestCase


class OrganizationPreprodHasDataEndpointTest(APITestCase):
    endpoint = "sentry-api-0-organization-preprod-has-data"

    def setUp(self) -> None:
        super().setUp()
        self.login_as(user=self.user)

    def test_returns_400_when_no_type_param(self) -> None:
        with self.feature("organizations:preprod-frontend-routes"):
            response = self.get_response(self.organization.slug)
        assert response.status_code == 400

    def test_returns_400_when_invalid_type_param(self) -> None:
        with self.feature("organizations:preprod-frontend-routes"):
            response = self.get_response(self.organization.slug, type="invalid")
        assert response.status_code == 400

    def test_returns_403_when_feature_flag_off(self) -> None:
        response = self.get_response(self.organization.slug, type="size")
        assert response.status_code == 403

    def test_size_false_when_no_artifacts(self) -> None:
        with self.feature("organizations:preprod-frontend-routes"):
            response = self.get_success_response(self.organization.slug, type="size")
        assert response.data == {"size": False}

    def test_snapshots_false_when_no_artifacts(self) -> None:
        with self.feature("organizations:preprod-frontend-routes"):
            response = self.get_success_response(self.organization.slug, type="snapshots")
        assert response.data == {"snapshots": False}

    def test_size_true_when_size_metrics_exist(self) -> None:
        artifact = self.create_preprod_artifact(
            project=self.project,
            state=PreprodArtifact.ArtifactState.PROCESSED,
        )
        self.create_preprod_artifact_size_metrics(artifact)

        with self.feature("organizations:preprod-frontend-routes"):
            response = self.get_success_response(self.organization.slug, type="size")
        assert response.data == {"size": True}

    def test_snapshots_true_when_snapshot_metrics_exist(self) -> None:
        artifact = self.create_preprod_artifact(
            project=self.project,
            state=PreprodArtifact.ArtifactState.PROCESSED,
        )
        PreprodSnapshotMetrics.objects.create(preprod_artifact=artifact, image_count=5)

        with self.feature("organizations:preprod-frontend-routes"):
            response = self.get_success_response(self.organization.slug, type="snapshots")
        assert response.data == {"snapshots": True}

    def test_both_types_returned_together(self) -> None:
        artifact = self.create_preprod_artifact(
            project=self.project,
            state=PreprodArtifact.ArtifactState.PROCESSED,
        )
        self.create_preprod_artifact_size_metrics(artifact)
        PreprodSnapshotMetrics.objects.create(preprod_artifact=artifact, image_count=5)

        with self.feature("organizations:preprod-frontend-routes"):
            response = self.get_success_response(self.organization.slug, type=["size", "snapshots"])
        assert response.data == {"size": True, "snapshots": True}

    def test_respects_time_range(self) -> None:
        now = timezone.now()
        artifact = self.create_preprod_artifact(
            project=self.project,
            state=PreprodArtifact.ArtifactState.PROCESSED,
            date_added=now - timedelta(days=30),
        )
        self.create_preprod_artifact_size_metrics(artifact)

        with self.feature("organizations:preprod-frontend-routes"):
            response = self.get_success_response(
                self.organization.slug,
                type="size",
                start=(now - timedelta(days=1)).isoformat(),
                end=now.isoformat(),
            )
        assert response.data == {"size": False}

    def test_respects_project_filter(self) -> None:
        other_project = self.create_project(organization=self.organization)
        artifact = self.create_preprod_artifact(
            project=other_project,
            state=PreprodArtifact.ArtifactState.PROCESSED,
        )
        self.create_preprod_artifact_size_metrics(artifact)

        with self.feature("organizations:preprod-frontend-routes"):
            response = self.get_success_response(
                self.organization.slug,
                type="size",
                project=[self.project.id],
            )
        assert response.data == {"size": False}

    def test_no_cross_org_data_leak(self) -> None:
        other_org = self.create_organization(owner=self.create_user())
        other_project = self.create_project(organization=other_org)
        artifact = self.create_preprod_artifact(
            project=other_project,
            state=PreprodArtifact.ArtifactState.PROCESSED,
        )
        self.create_preprod_artifact_size_metrics(artifact)

        with self.feature("organizations:preprod-frontend-routes"):
            response = self.get_success_response(self.organization.slug, type="size")
        assert response.data == {"size": False}
