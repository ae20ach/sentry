from unittest.mock import patch

import orjson

from sentry.silo.base import SiloMode
from sentry.testutils.cases import APITestCase
from sentry.testutils.helpers import install_slack
from sentry.testutils.silo import assume_test_silo_mode
from sentry.users.models.identity import Identity, IdentityStatus

UNSET = object()

SEER_EXPLORER_FEATURES = {
    "organizations:seer-slack-explorer": True,
    "organizations:gen-ai-features": True,
    "organizations:seer-explorer": True,
}

LINK_SHARED_EVENT = """{
    "type": "link_shared",
    "channel": "Cxxxxxx",
    "channel_name": "general",
    "user": "Uxxxxxxx",
    "message_ts": "123456789.9875",
    "team_id": "TXXXXXXX1",
    "links": [
        {
            "domain": "example.com",
            "url": "http://testserver/organizations/test-org/issues/foo/"
        },
        {
            "domain": "example.com",
            "url": "http://testserver/organizations/test-org/issues/bar/baz/"
        },
        {
            "domain": "example.com",
            "url": "http://testserver/organizations/test-org/issues/bar/baz/"
        }
    ]
}"""


def build_test_block(link):
    return {
        "blocks": [
            {
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": f"<{link}/1|*wow an issue very cool*> \n",
                },
                "block_id": orjson.dumps({"issue": 1}).decode(),
            }
        ],
        "text": "[foo] wow an issue very cool",
    }


class BaseEventTest(APITestCase):
    def setUp(self) -> None:
        super().setUp()
        self.integration = install_slack(self.organization)

    def link_identity(self, user=None, slack_user_id="U1234567890"):
        """Link a Slack identity for identity resolution in Seer handlers."""
        with assume_test_silo_mode(SiloMode.CONTROL):
            idp = self.create_identity_provider(
                type="slack", external_id=self.integration.external_id
            )
            Identity.objects.create(
                external_id=slack_user_id,
                idp=idp,
                user=user or self.user,
                status=IdentityStatus.VALID,
                scopes=[],
            )

    @patch(
        "sentry.integrations.slack.requests.SlackRequest._check_signing_secret", return_value=True
    )
    def post_webhook(
        self,
        check_signing_secret_mock,
        event_data=None,
        type="event_callback",
        data=None,
        token=UNSET,
        team_id="TXXXXXXX1",
    ):
        payload = {
            "team_id": team_id,
            "api_app_id": "AXXXXXXXX1",
            "type": type,
            "authed_users": [],
            "event_id": "Ev08MFMKH6",
            "event_time": 123456789,
        }
        if data:
            payload.update(data)
        if event_data:
            payload.setdefault("event", {}).update(event_data)

        return self.client.post("/extensions/slack/event/", payload)
