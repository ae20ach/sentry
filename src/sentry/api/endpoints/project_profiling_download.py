import zstandard
from django.http import StreamingHttpResponse
from rest_framework.request import Request
from rest_framework.response import Response

from sentry.api.api_owners import ApiOwner
from sentry.api.api_publish_status import ApiPublishStatus
from sentry.api.base import region_silo_endpoint
from sentry.api.bases.project import ProjectEndpoint
from sentry.models.files.utils import get_profiles_storage
from sentry.models.project import Project


@region_silo_endpoint
class ProjectProfilingDownloadEndpoint(ProjectEndpoint):
    owner = ApiOwner.PROFILING
    publish_status = {
        "GET": ApiPublishStatus.PRIVATE,
    }

    def get(self, request: Request, project: Project, chunk_id: str, trace_format: str) -> Response:
        storage = get_profiles_storage()
        path = f"profiles/raw/{project.id}/{chunk_id}/{trace_format}.zstd"
        try:
            f = storage.open(path)
        except Exception:
            return Response(status=404)
        with f:
            decompressed = zstandard.decompress(f.read())
        response = StreamingHttpResponse(
            iter([decompressed]),
            content_type="application/octet-stream",
        )
        response["Content-Disposition"] = f'attachment; filename="{chunk_id}.{trace_format}"'
        response["Content-Length"] = len(decompressed)
        return response
