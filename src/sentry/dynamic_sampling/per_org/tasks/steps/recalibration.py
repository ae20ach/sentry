"""Step 4: compute the adjustment factor(s) from accepted vs. target indexed volume.

Uses the outcomes result from step 1 (no additional query needed).
"""

from __future__ import annotations

from sentry.models.organization import Organization


def apply_recalibration(org_id: int, organization: Organization, outcomes: object) -> None:
    pass
