from collections.abc import Generator, Mapping
from contextlib import contextmanager
from unittest.mock import patch

import sentry.features

__all__ = ("Experiment",)


@contextmanager
def Experiment(assignments: str | dict[str, str]) -> Generator[None]:
    """
    Control experiment assignments for testing.

    >>> with Experiment({"my-experiment": "active"}):
    >>>     # organization.experiments will include {"my-experiment": "active"}

    A single experiment name defaults to "active":

    >>> with Experiment("my-experiment"):
    >>>     # equivalent to {"my-experiment": "active"}
    """
    if isinstance(assignments, str):
        assignments = {assignments: "active"}
    elif not isinstance(assignments, Mapping):
        assignments = {k: "active" for k in assignments}

    default_get = sentry.features.get_experiment_assignments

    def override(organization, actor=None):
        result = default_get(organization, actor)
        result.update(assignments)
        return result

    with patch("sentry.features.get_experiment_assignments") as mock_get:
        mock_get.side_effect = override
        yield
