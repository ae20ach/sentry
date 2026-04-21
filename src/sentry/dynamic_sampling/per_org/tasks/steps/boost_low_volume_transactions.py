"""Step 6: redistribute each project's sample rate across large/small transactions.

Consumes the large/small transaction volumes from the EAP batch in step 2.
"""

from __future__ import annotations

from sentry.models.organization import Organization


def boost_low_volume_transactions(org_id: int, organization: Organization, eap: object) -> None:
    pass
