from scm.manager import SourceCodeManager
from scm.types import CreatePullRequestReactionProtocol

from sentry.integrations.models import Integration
from sentry.scm.private.event_stream import scm_event_stream
from sentry.scm.types import PullRequestEvent


@scm_event_stream.listen_for_pull_request
def handle_pull_request_via_scm_stream(e: PullRequestEvent) -> None:
    # print(f"VJA: received pull request event: {e}", flush=True)

    # @todo(When we remove the old handlers for GitHub) Remove this check, and process GitHub webhooks
    if e.subscription_event["type"] != "gitlab":
        return

    # Do a milion checks to decide wether to process this event

    # @todo(NOW) Implement the milion checks

    if e.action not in ["opened", "reopened"]:
        return

    # Process the event

    if e.subscription_event["type"] == "gitlab":
        sentry_meta = e.subscription_event["sentry_meta"]
        assert sentry_meta is not None
        assert len(sentry_meta) == 1
        organization_id = sentry_meta[0]["organization_id"]
        assert organization_id is not None
        integration_id = sentry_meta[0]["integration_id"]
        assert integration_id is not None
        integration = Integration.objects.get(id=integration_id)
        # @todo(NOW) Use the actual hostname for this GitLab instance.
        repository_id = (integration.provider, f"gitlab.com:{e.pull_request['repo_id']}")
    else:
        assert False

    scm = SourceCodeManager.make_from_repository_id(
        organization_id=organization_id, repository_id=repository_id
    )
    if isinstance(scm, CreatePullRequestReactionProtocol):
        scm.create_pull_request_reaction(
            pull_request_id=e.pull_request["id"],
            reaction="eyes",
        )

    # Forward the event to Seer

    # @todo(NOW) Implement forwarding the event to Seer
