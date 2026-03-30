import zstandard
from django.core.files.base import ContentFile

from sentry.models.files.utils import get_profiles_storage
from sentry.testutils.cases import APITestCase


class ProjectProfilingDownloadTest(APITestCase):
    endpoint = "sentry-api-0-project-profiling-download"

    def setUp(self) -> None:
        self.login_as(user=self.user)

    def test_download_raw_profile(self) -> None:
        raw_data = b"fake perfetto binary data"
        compressed = zstandard.compress(raw_data)
        chunk_id = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"

        storage = get_profiles_storage()
        path = f"profiles/raw/{self.project.id}/{chunk_id}/perfetto.zstd"
        storage.save(path, ContentFile(compressed))

        response = self.get_success_response(
            self.project.organization.slug,
            self.project.slug,
            chunk_id,
            "perfetto",
        )
        assert response.status_code == 200
        assert response["Content-Type"] == "application/octet-stream"
        assert response["Content-Disposition"] == f'attachment; filename="{chunk_id}.perfetto"'
        assert b"".join(response.streaming_content) == raw_data

    def test_returns_404_when_trace_does_not_exist(self) -> None:
        chunk_id = "aaaaaaaa-bbbb-cccc-dddd-ffffffffffff"
        response = self.get_response(
            self.project.organization.slug,
            self.project.slug,
            chunk_id,
            "perfetto",
        )
        assert response.status_code == 404
