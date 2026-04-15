from sentry.api.bases.organization import OrganizationPermission
from sentry.discover.models import DiscoverSavedQuery
from sentry.models.organization import Organization


class DiscoverSavedQueryPermission(OrganizationPermission):
    scope_map = {
        "GET": ["org:read", "org:searches"],
        "POST": ["org:searches"],
        "PUT": ["org:searches"],
        "DELETE": ["org:searches"],
    }

    def has_object_permission(self, request, view, obj):
        if isinstance(obj, Organization):
            return super().has_object_permission(request, view, obj)

        if isinstance(obj, DiscoverSavedQuery):
            # 1. Saved Query contains certain projects
            if obj.projects.exists():
                return request.access.has_projects_access(obj.projects.all())

            # 2. Saved Query covers all projects or all my projects

            # allow when Open Membership
            if obj.organization.flags.allow_joinleave:
                return True

            # allow for Managers and Owners
            if request.access.has_scope("org:write"):
                return True

            # allow for creator
            if request.user.id == obj.created_by_id:
                return True

            return False
        return True
