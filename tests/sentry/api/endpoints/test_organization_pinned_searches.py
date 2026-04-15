from functools import cached_property

from sentry.api.endpoints.organization_pinned_searches import PINNED_SEARCH_NAME
from sentry.models.groupsearchview import GroupSearchView
from sentry.models.groupsearchviewstarred import GroupSearchViewStarred
from sentry.models.savedsearch import SavedSearch, SortOptions, Visibility
from sentry.models.search_common import SearchType
from sentry.testutils.cases import APITestCase


class CreateOrganizationPinnedSearchTest(APITestCase):
    endpoint = "sentry-api-0-organization-pinned-searches"
    method = "put"

    @cached_property
    def member(self):
        user = self.create_user("test@test.com")
        self.create_member(organization=self.organization, user=user)
        return user

    def get_response(self, *args, **params):
        return super().get_response(*((self.organization.slug,) + args), **params)

    def test(self) -> None:
        self.login_as(self.member)
        query = "test"
        search_type = SearchType.ISSUE.value
        sort = SortOptions.DATE
        self.get_success_response(type=search_type, query=query, sort=sort, status_code=201)
        assert SavedSearch.objects.filter(
            organization=self.organization,
            name=PINNED_SEARCH_NAME,
            owner_id=self.member.id,
            type=search_type,
            query=query,
            sort=sort,
            visibility=Visibility.OWNER_PINNED,
        ).exists()

        # Errors out if no default view is found, inherently verifying existence.
        default_view = GroupSearchView.objects.get(
            organization=self.organization,
            name="Default Search",
            user_id=self.member.id,
            query=query,
            query_sort=sort,
        )
        assert GroupSearchViewStarred.objects.filter(
            organization=self.organization,
            user_id=self.member.id,
            group_search_view=default_view,
            position=0,
        ).exists()

        query = "test_2"
        self.get_success_response(type=search_type, query=query, sort=sort, status_code=201)
        assert SavedSearch.objects.filter(
            organization=self.organization,
            name=PINNED_SEARCH_NAME,
            owner_id=self.member.id,
            type=search_type,
            query=query,
            sort=sort,
            visibility=Visibility.OWNER_PINNED,
        ).exists()

        self.get_success_response(type=SearchType.EVENT.value, query=query, status_code=201)
        assert SavedSearch.objects.filter(
            organization=self.organization,
            name=PINNED_SEARCH_NAME,
            owner_id=self.member.id,
            type=search_type,
            query=query,
        ).exists()
        assert SavedSearch.objects.filter(
            organization=self.organization,
            name=PINNED_SEARCH_NAME,
            owner_id=self.member.id,
            type=SearchType.EVENT.value,
            query=query,
            visibility=Visibility.OWNER_PINNED,
        ).exists()

        self.login_as(self.user)
        self.get_success_response(type=search_type, query=query, status_code=201)
        assert SavedSearch.objects.filter(
            organization=self.organization,
            name=PINNED_SEARCH_NAME,
            owner_id=self.member.id,
            type=search_type,
            query=query,
            visibility=Visibility.OWNER_PINNED,
        ).exists()
        assert SavedSearch.objects.filter(
            organization=self.organization,
            name=PINNED_SEARCH_NAME,
            owner_id=self.user.id,
            type=search_type,
            query=query,
            visibility=Visibility.OWNER_PINNED,
        ).exists()

    def test_pin_sort_mismatch(self) -> None:
        saved_search = SavedSearch.objects.create(
            organization=self.organization,
            owner_id=self.member.id,
            type=SearchType.ISSUE.value,
            sort=SortOptions.FREQ,
            query="wat",
            visibility=Visibility.OWNER_PINNED,
        )
        self.login_as(self.user)
        resp = self.get_success_response(
            sort=SortOptions.DATE, type=saved_search.type, query=saved_search.query, status_code=201
        )
        assert resp.data["isPinned"]
        assert resp.data["id"] != str(saved_search.id)

    def test_invalid_type(self) -> None:
        self.login_as(self.member)
        resp = self.get_response(type=55, query="test", status_code=201)
        assert resp.status_code == 400
        assert "not a valid SearchType" in resp.data["type"][0]

    def test_empty_query(self) -> None:
        self.login_as(self.member)
        query = ""
        search_type = SearchType.ISSUE.value
        sort = SortOptions.DATE
        self.get_success_response(type=search_type, query=query, sort=sort, status_code=201)
        assert SavedSearch.objects.filter(
            organization=self.organization,
            name=PINNED_SEARCH_NAME,
            owner_id=self.member.id,
            type=search_type,
            query=query,
            sort=sort,
            visibility=Visibility.OWNER_PINNED,
        ).exists()

    def test_put_with_user_preferences_token(self) -> None:
        token = self.create_user_auth_token(user=self.member, scope_list=["user:preferences"])

        response = self.client.put(
            self.get_path(self.organization.slug),
            {"type": SearchType.ISSUE.value, "query": "test", "sort": SortOptions.DATE},
            HTTP_AUTHORIZATION=f"Bearer {token.token}",
        )

        assert response.status_code == 201, response.content

    def test_put_rejects_org_write_token(self) -> None:
        token = self.create_user_auth_token(user=self.member, scope_list=["org:write"])

        response = self.client.put(
            self.get_path(self.organization.slug),
            {"type": SearchType.ISSUE.value, "query": "test", "sort": SortOptions.DATE},
            HTTP_AUTHORIZATION=f"Bearer {token.token}",
        )

        assert response.status_code == 403, response.content


class DeleteOrganizationPinnedSearchTest(APITestCase):
    endpoint = "sentry-api-0-organization-pinned-searches"
    method = "delete"

    @cached_property
    def member(self):
        user = self.create_user("test@test.com")
        self.create_member(organization=self.organization, user=user)
        return user

    def get_response(self, *args, **params):
        return super().get_response(*((self.organization.slug,) + args), **params)

    def test(self) -> None:
        saved_search = SavedSearch.objects.create(
            organization=self.organization,
            owner_id=self.member.id,
            type=SearchType.ISSUE.value,
            query="wat",
            visibility=Visibility.OWNER_PINNED,
        )
        other_saved_search = SavedSearch.objects.create(
            organization=self.organization,
            owner_id=self.user.id,
            type=SearchType.ISSUE.value,
            query="wat",
            visibility=Visibility.OWNER_PINNED,
        )

        self.login_as(self.member)
        self.get_success_response(type=saved_search.type, status_code=204)
        assert not SavedSearch.objects.filter(id=saved_search.id).exists()
        assert SavedSearch.objects.filter(id=other_saved_search.id).exists()

        # Test calling multiple times works ok, doesn't cause other rows to
        # delete
        self.get_success_response(type=saved_search.type, status_code=204)
        assert SavedSearch.objects.filter(id=other_saved_search.id).exists()

    def test_views_deleted(self) -> None:
        self.login_as(self.member)

        saved_search = SavedSearch.objects.create(
            organization=self.organization,
            owner_id=self.member.id,
            type=SearchType.ISSUE.value,
            query="wat",
            visibility=Visibility.OWNER_PINNED,
        )

        self.get_success_response(type=saved_search.type, status_code=204)
        assert not SavedSearch.objects.filter(id=saved_search.id).exists()
        assert not GroupSearchView.objects.filter(
            organization=self.organization, user_id=self.member.id
        ).exists()

    def test_invalid_type(self) -> None:
        self.login_as(self.member)
        resp = self.get_response(type=55)
        assert resp.status_code == 400
        assert "Invalid input for `type`" in resp.data["detail"]

    def test_delete_with_user_preferences_token(self) -> None:
        token = self.create_user_auth_token(user=self.member, scope_list=["user:preferences"])
        saved_search = SavedSearch.objects.create(
            organization=self.organization,
            owner_id=self.member.id,
            type=SearchType.ISSUE.value,
            query="wat",
            visibility=Visibility.OWNER_PINNED,
        )

        response = self.client.delete(
            self.get_path(self.organization.slug),
            {"type": saved_search.type},
            HTTP_AUTHORIZATION=f"Bearer {token.token}",
        )

        assert response.status_code == 204, response.content

    def test_delete_rejects_org_write_token(self) -> None:
        token = self.create_user_auth_token(user=self.member, scope_list=["org:write"])
        saved_search = SavedSearch.objects.create(
            organization=self.organization,
            owner_id=self.member.id,
            type=SearchType.ISSUE.value,
            query="wat",
            visibility=Visibility.OWNER_PINNED,
        )

        response = self.client.delete(
            self.get_path(self.organization.slug),
            {"type": saved_search.type},
            HTTP_AUTHORIZATION=f"Bearer {token.token}",
        )

        assert response.status_code == 403, response.content
