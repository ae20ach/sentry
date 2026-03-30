from __future__ import annotations

import zipfile
from base64 import b64encode
from io import BytesIO
from os.path import join
from typing import Any
from unittest import mock
from unittest.mock import patch

import msgpack
import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.urls import reverse

from sentry.constants import DataCategory
from sentry.lang.javascript.processing import _handles_frame as is_valid_javascript_frame
from sentry.models.files.file import File
from sentry.models.organization import Organization
from sentry.models.project import Project
from sentry.models.projectsdk import EventType, ProjectSDK
from sentry.models.release import Release
from sentry.models.releasefile import ReleaseFile
from sentry.profiles.task import (
    _calculate_profile_duration_ms,
    _deobfuscate,
    _deobfuscate_using_symbolicator,
    _normalize,
    _prepare_frames_from_profile,
    _process_symbolicator_results_for_sample,
    _set_frames_platform,
    _set_in_app_for_android_v2_frames,
    _store_raw_profile,
    _symbolicate_profile,
    process_profile_task,
)
from sentry.profiles.utils import Profile
from sentry.signals import first_profile_received
from sentry.testutils.cases import TransactionTestCase
from sentry.testutils.factories import Factories, get_fixture_path
from sentry.testutils.helpers import Feature, override_options
from sentry.testutils.pytest.fixtures import django_db_all
from sentry.testutils.skips import requires_symbolicator
from sentry.testutils.thread_leaks.pytest import thread_leak_allowlist
from sentry.utils import json
from sentry.utils.outcomes import Outcome

PROFILES_FIXTURES_PATH = get_fixture_path("profiles")

PROGUARD_UUID = "6dc7fdb0-d2fb-4c8e-9d6b-bb1aa98929b1"
PROGUARD_SOURCE = b"""\
# compiler: R8
# compiler_version: 2.0.74
# min_api: 16
# pg_map_id: 5b46fdc
# common_typos_disable
# {"id":"com.android.tools.r8.mapping","version":"1.0"}
org.slf4j.helpers.Util$ClassContextSecurityManager -> org.a.b.g$a:
    65:65:void <init>() -> <init>
    67:67:java.lang.Class[] getClassContext() -> a
    69:69:java.lang.Class[] getExtraClassContext() -> a
    65:65:void <init>(org.slf4j.helpers.Util$1) -> <init>
"""
PROGUARD_INLINE_UUID = "d748e578-b3d1-5be5-b0e5-a42e8c9bf8e0"
PROGUARD_INLINE_SOURCE = b"""\
# compiler: R8
# compiler_version: 2.0.74
# min_api: 16
# pg_map_id: 5b46fdc
# common_typos_disable
# {"id":"com.android.tools.r8.mapping","version":"1.0"}
$r8$backportedMethods$utility$Objects$2$equals -> a:
    boolean equals(java.lang.Object,java.lang.Object) -> a
$r8$twr$utility -> b:
    void $closeResource(java.lang.Throwable,java.lang.Object) -> a
android.support.v4.app.RemoteActionCompatParcelizer -> android.support.v4.app.RemoteActionCompatParcelizer:
    1:1:void <init>():11:11 -> <init>
io.sentry.sample.-$$Lambda$r3Avcbztes2hicEObh02jjhQqd4 -> e.a.c.a:
    io.sentry.sample.MainActivity f$0 -> b
io.sentry.sample.MainActivity -> io.sentry.sample.MainActivity:
    1:1:void <init>():15:15 -> <init>
    1:1:boolean onCreateOptionsMenu(android.view.Menu):60:60 -> onCreateOptionsMenu
    1:1:boolean onOptionsItemSelected(android.view.MenuItem):69:69 -> onOptionsItemSelected
    2:2:boolean onOptionsItemSelected(android.view.MenuItem):76:76 -> onOptionsItemSelected
    1:1:void bar():54:54 -> t
    1:1:void foo():44 -> t
    1:1:void onClickHandler(android.view.View):40 -> t
"""
PROGUARD_BUG_UUID = "071207ac-b491-4a74-957c-2c94fd9594f2"
PROGUARD_BUG_SOURCE = b"x"


def load_profile(name):
    path = join(PROFILES_FIXTURES_PATH, name)
    with open(path) as f:
        return json.loads(f.read())


@pytest.fixture
def owner():
    return Factories.create_user()


@pytest.fixture
def organization(owner):
    return Factories.create_organization(owner=owner)


@pytest.fixture
def team(organization, owner):
    team = Factories.create_team(organization=organization)
    Factories.create_team_membership(team=team, user=owner)
    return team


@pytest.fixture
def project(organization, team):
    return Factories.create_project(organization=organization, teams=[team])


@pytest.fixture
def ios_profile():
    return load_profile("valid_ios_profile.json")


@pytest.fixture
def android_profile():
    return load_profile("valid_android_profile.json")


@pytest.fixture
def sample_v1_profile():
    return json.loads(
        """{
  "event_id": "41fed0925670468bb0457f61a74688ec",
  "version": "1",
  "os": {
    "name": "iOS",
    "version": "16.0",
    "build_number": "19H253"
  },
  "device": {
    "architecture": "arm64e",
    "is_emulator": false,
    "locale": "en_US",
    "manufacturer": "Apple",
    "model": "iPhone14,3"
  },
  "timestamp": "2022-09-01T09:45:00.000Z",
  "profile": {
    "samples": [
      {
        "stack_id": 0,
        "thread_id": "1",
        "queue_address": "0x0000000102adc700",
        "elapsed_since_start_ns": "10500500"
      },
      {
        "stack_id": 1,
        "thread_id": "1",
        "queue_address": "0x0000000102adc700",
        "elapsed_since_start_ns": "20500500"
      },
      {
        "stack_id": 0,
        "thread_id": "1",
        "queue_address": "0x0000000102adc700",
        "elapsed_since_start_ns": "30500500"
      },
      {
        "stack_id": 1,
        "thread_id": "1",
        "queue_address": "0x0000000102adc700",
        "elapsed_since_start_ns": "35500500"
      }
    ],
    "stacks": [[0], [1]],
    "frames": [
      {"instruction_addr": "0xa722447ffffffffc"},
      {"instruction_addr": "0x442e4b81f5031e58"}
    ],
    "thread_metadata": {
      "1": {"priority": 31},
      "2": {}
    },
    "queue_metadata": {
      "0x0000000102adc700": {"label": "com.apple.main-thread"},
      "0x000000016d8fb180": {"label": "com.apple.network.connections"}
    }
  },
  "release": "0.1 (199)",
  "platform": "cocoa",
  "debug_meta": {
    "images": [
      {
        "debug_id": "32420279-25E2-34E6-8BC7-8A006A8F2425",
        "image_addr": "0x000000010258c000",
        "code_file": "/private/var/containers/Bundle/Application/C3511752-DD67-4FE8-9DA2-ACE18ADFAA61/TrendingMovies.app/TrendingMovies",
        "type": "macho",
        "image_size": 1720320,
        "image_vmaddr": "0x0000000100000000"
      }
    ]
  },
  "transaction": {
      "name": "example_ios_movies_sources.MoviesViewController",
      "trace_id": "4b25bc58f14243d8b208d1e22a054164",
      "id": "30976f2ddbe04ac9b6bffe6e35d4710c",
      "active_thread_id": "259",
      "relative_start_ns": "500500",
      "relative_end_ns": "50500500"
  },
  "client_sdk": {
    "name": "sentry.python",
    "version": "2.24.1"
  }
}"""
    )


@pytest.fixture
def sample_v1_profile_without_transaction_timestamps(sample_v1_profile):
    for key in {"relative_start_ns", "relative_end_ns"}:
        del sample_v1_profile["transaction"][key]
    return sample_v1_profile


def generate_sample_v2_profile():
    return json.loads(
        """{
  "event_id": "41fed0925670468bb0457f61a74688ec",
  "version": "2",
  "profile": {
    "samples": [
      {
        "stack_id": 0,
        "thread_id": "1",
        "timestamp": 1710958503.629
      },
      {
        "stack_id": 1,
        "thread_id": "1",
        "timestamp": 1710958504.629
      },
      {
        "stack_id": 0,
        "thread_id": "1",
        "timestamp": 1710958505.629
      },
      {
        "stack_id": 1,
        "thread_id": "1",
        "timestamp": 1710958506.629
      }
    ],
    "stacks": [[0], [1]],
    "frames": [
      {"instruction_addr": "0xa722447ffffffffc"},
      {"instruction_addr": "0x442e4b81f5031e58"}
    ],
    "thread_metadata": {
      "1": {"priority": 31},
      "2": {}
    }
  },
  "release": "0.1 (199)",
  "platform": "cocoa",
  "debug_meta": {
    "images": [
      {
        "debug_id": "32420279-25E2-34E6-8BC7-8A006A8F2425",
        "image_addr": "0x000000010258c000",
        "code_file": "/private/var/containers/Bundle/Application/C3511752-DD67-4FE8-9DA2-ACE18ADFAA61/TrendingMovies.app/TrendingMovies",
        "type": "macho",
        "image_size": 1720320,
        "image_vmaddr": "0x0000000100000000"
      }
    ]
  },
  "client_sdk": {
    "name": "sentry.python",
    "version": "2.24.1"
  }
}"""
    )


@pytest.fixture
def sample_v2_profile():
    return generate_sample_v2_profile()


@pytest.fixture
def sample_v2_profile_long():
    profile = generate_sample_v2_profile()
    samples = profile["profile"]["samples"]
    samples[len(samples) - 1]["timestamp"] += 300
    return profile


@pytest.fixture
def sample_v2_profile_samples_not_sorted():
    profile = generate_sample_v2_profile()
    profile["profile"]["samples"][0]["timestamp"] += 300
    return profile


@django_db_all
def test_normalize_sample_v1_profile(organization, sample_v1_profile) -> None:
    sample_v1_profile["transaction_tags"] = {"device.class": "1"}

    _normalize(profile=sample_v1_profile, organization=organization)

    assert sample_v1_profile.get("os", {}).get("build_number")
    assert sample_v1_profile.get("device", {}).get("classification")
    assert sample_v1_profile["device"]["classification"] == "low"


@django_db_all
def test_normalize_ios_profile(organization, ios_profile) -> None:
    ios_profile["transaction_tags"] = {"device.class": "1"}

    _normalize(profile=ios_profile, organization=organization)
    for k in ["device_os_build_number", "device_classification"]:
        assert k in ios_profile

    assert ios_profile["device_classification"] == "low"


@django_db_all
def test_normalize_android_profile(organization, android_profile) -> None:
    android_profile["transaction_tags"] = {"device.class": "1"}

    _normalize(profile=android_profile, organization=organization)
    for k in ["android_api_level", "device_classification"]:
        assert k in android_profile

    assert isinstance(android_profile["android_api_level"], int)
    assert android_profile["device_classification"] == "low"


def test_process_symbolicator_results_for_sample() -> None:
    profile: dict[str, Any] = {
        "version": 1,
        "platform": "rust",
        "profile": {
            "frames": [
                {
                    "instruction_addr": "0x55bd050e168d",
                    "lang": "rust",
                    "sym_addr": "0x55bd050e1590",
                },
                {
                    "instruction_addr": "0x89bf050e178a",
                    "lang": "rust",
                    "sym_addr": "0x95bc050e2530",
                },
                {
                    "instruction_addr": "0x88ad050d167e",
                    "lang": "rust",
                    "sym_addr": "0x29cd050a1642",
                },
            ],
            "samples": [
                {"stack_id": 0},
                # a second sample with the same stack id, the stack should
                # not be processed a second time
                {"stack_id": 0},
            ],
            "stacks": [
                [0, 1, 2],
            ],
        },
    }

    # returned from symbolicator
    stacktraces = [
        {
            "frames": [
                {
                    "instruction_addr": "0x72ba053e168c",
                    "lang": "rust",
                    "function": "C_inline_1",
                    "original_index": 0,
                },
                {
                    "instruction_addr": "0x55bd050e168d",
                    "lang": "rust",
                    "function": "C",
                    "sym_addr": "0x55bd050e1590",
                    "original_index": 0,
                },
                {
                    "instruction_addr": "0x89bf050e178a",
                    "lang": "rust",
                    "function": "B",
                    "sym_addr": "0x95bc050e2530",
                    "original_index": 1,
                },
                {
                    "instruction_addr": "0x68fd050d127b",
                    "lang": "rust",
                    "function": "A_inline_1",
                    "original_index": 2,
                },
                {
                    "instruction_addr": "0x29ce061d168a",
                    "lang": "rust",
                    "function": "A_inline_2",
                    "original_index": 2,
                },
                {
                    "instruction_addr": "0x88ad050d167e",
                    "lang": "rust",
                    "function": "A",
                    "sym_addr": "0x29cd050a1642",
                    "original_index": 2,
                },
            ],
        },
    ]

    _process_symbolicator_results_for_sample(
        profile,
        stacktraces,
        set(range(len(profile["profile"]["frames"]))),
        profile["platform"],
    )

    assert profile["profile"]["stacks"] == [[0, 1, 2, 3, 4, 5]]


def test_process_symbolicator_results_for_sample_js() -> None:
    profile: dict[str, Any] = {
        "version": 1,
        "platform": "javascript",
        "profile": {
            "frames": [
                {
                    "function": "functionA",
                    "abs_path": "/root/functionA.js",
                },
                {
                    "function": "functionB",
                    "abs_path": "/root/functionB.js",
                },
                {
                    "function": "functionC",
                    "abs_path": "/root/functionC.js",
                },
                # frame not valid for symbolication
                {
                    "function": "functionD",
                },
            ],
            "samples": [
                {"stack_id": 0},
                # a second sample with the same stack id, the stack should
                # not be processed a second time
                {"stack_id": 0},
            ],
            "stacks": [
                [0, 1, 2, 3],
            ],
        },
    }

    # returned from symbolicator
    stacktraces = [
        {
            "frames": [
                {
                    "function": "functionA",
                    "abs_path": "/root/functionA.js",
                    "original_index": 0,
                },
                {
                    "function": "functionB",
                    "abs_path": "/root/functionB.js",
                    "original_index": 1,
                },
                {
                    "function": "functionC",
                    "abs_path": "/root/functionC.js",
                    "original_index": 2,
                },
            ],
        },
    ]

    frames_sent = [
        idx
        for idx, frame in enumerate(profile["profile"]["frames"])
        if is_valid_javascript_frame(frame, profile)
    ]

    _process_symbolicator_results_for_sample(
        profile, stacktraces, set(frames_sent), profile["platform"]
    )

    assert profile["profile"]["stacks"] == [[0, 1, 2, 3]]


def test_process_symbolicator_results_for_perfetto_mixed_platforms() -> None:
    """Test that a perfetto profile with both java and native frames
    is correctly symbolicated in two sequential passes, and the results
    are merged back into a single frames list."""

    # Perfetto profile with mixed java (indices 0, 2) and native (indices 1, 3) frames.
    # Stack is: java_A -> native_B -> java_C -> native_D (callee to caller)
    profile: dict[str, Any] = {
        "version": "2",
        "platform": "android",
        "raw_profile_content_type": "perfetto",
        "debug_meta": {
            "images": [
                {"type": "proguard", "uuid": "abc123"},
                {"type": "elf", "code_id": "def456", "image_addr": "0x7000000000"},
            ],
        },
        "profile": {
            "frames": [
                {
                    "function": "a.b.c.obfuscated1",
                    "platform": "java",
                },
                {
                    "function": "",
                    "instruction_addr": "0x7000001000",
                    "platform": "native",
                },
                {
                    "function": "a.b.c.obfuscated2",
                    "platform": "java",
                },
                {
                    "function": "",
                    "instruction_addr": "0x7000002000",
                    "platform": "native",
                },
            ],
            "samples": [
                {"stack_id": 0, "timestamp": 1000.0, "thread_id": "1"},
            ],
            "stacks": [
                [0, 1, 2, 3],
            ],
        },
    }

    # --- Pass 1: java frames (indices 0, 2) ---
    _, _, java_frames_sent = _prepare_frames_from_profile(profile, "java")

    # The leaf frame (index 0, java) is deepcopied with adjust_instruction_addr=False
    # and appended as index 4. stack[0] is updated to point to this copy.
    assert java_frames_sent == {0, 2, 4}
    assert profile["profile"]["stacks"] == [[4, 1, 2, 3]]

    # Symbolicator returns deobfuscated java frames (3 frames sent: indices 0, 2, 4)
    java_stacktraces = [
        {
            "frames": [
                {
                    "function": "com.example.ClassA.method1",
                    "platform": "java",
                    "original_index": 0,
                },
                {
                    "function": "com.example.ClassB.method2",
                    "platform": "java",
                    "original_index": 1,
                },
                {
                    "function": "com.example.ClassA.method1",
                    "platform": "java",
                    "original_index": 2,
                },
            ],
        },
    ]

    _process_symbolicator_results_for_sample(profile, java_stacktraces, java_frames_sent, "java")

    # After java pass: java frames deobfuscated, native frames unchanged.
    assert profile["profile"]["frames"][0]["function"] == "com.example.ClassA.method1"
    assert profile["profile"]["frames"][1]["function"] == ""
    assert profile["profile"]["frames"][1]["platform"] == "native"
    assert profile["profile"]["frames"][2]["function"] == "com.example.ClassB.method2"
    assert profile["profile"]["frames"][3]["function"] == ""
    assert profile["profile"]["frames"][3]["platform"] == "native"
    # Index 4 is the deobfuscated leaf frame copy
    assert profile["profile"]["frames"][4]["function"] == "com.example.ClassA.method1"

    # --- Pass 2: native frames (indices 1, 3) ---
    _, _, native_frames_sent = _prepare_frames_from_profile(profile, "native")
    assert native_frames_sent == {1, 3}

    native_stacktraces = [
        {
            "frames": [
                {
                    "function": "libc.so!malloc",
                    "instruction_addr": "0x7000001000",
                    "platform": "native",
                    "original_index": 0,
                },
                {
                    "function": "libhwui.so!drawFrame",
                    "instruction_addr": "0x7000002000",
                    "platform": "native",
                    "original_index": 1,
                },
            ],
        },
    ]

    _process_symbolicator_results_for_sample(
        profile, native_stacktraces, native_frames_sent, "native"
    )

    # After both passes: all frames should be symbolicated/deobfuscated.
    assert profile["profile"]["frames"][0]["function"] == "com.example.ClassA.method1"
    assert profile["profile"]["frames"][0]["platform"] == "java"
    assert profile["profile"]["frames"][1]["function"] == "libc.so!malloc"
    assert profile["profile"]["frames"][1]["platform"] == "native"
    assert profile["profile"]["frames"][2]["function"] == "com.example.ClassB.method2"
    assert profile["profile"]["frames"][2]["platform"] == "java"
    assert profile["profile"]["frames"][3]["function"] == "libhwui.so!drawFrame"
    assert profile["profile"]["frames"][3]["platform"] == "native"
    # Index 4: leaf frame copy, also deobfuscated
    assert profile["profile"]["frames"][4]["function"] == "com.example.ClassA.method1"
    assert profile["profile"]["frames"][4]["platform"] == "java"

    # Stack uses index 4 for the leaf (adjust_instruction_addr copy of frame 0).
    assert profile["profile"]["stacks"] == [[4, 1, 2, 3]]


@django_db_all
def test_decode_signature(project, android_profile) -> None:
    android_profile.update(
        {
            "project_id": project.id,
            "profile": {
                "methods": [
                    {
                        "abs_path": None,
                        "class_name": "org.a.b.g$a",
                        "name": "a",
                        "signature": "()V",
                        "source_file": None,
                        "source_line": 67,
                    },
                    {
                        "abs_path": None,
                        "class_name": "org.a.b.g$a",
                        "name": "a",
                        "signature": "()Z",
                        "source_file": None,
                        "source_line": 69,
                    },
                ],
            },
        }
    )
    _deobfuscate(android_profile, project)
    frames = android_profile["profile"]["methods"]

    assert frames[0]["signature"] == "()"
    assert frames[1]["signature"] == "(): boolean"


@django_db_all
@pytest.mark.parametrize(
    "profile, duration_ms",
    [
        ("sample_v1_profile", 50),
        ("sample_v2_profile", 3000),
        ("android_profile", 2020),
        ("sample_v1_profile_without_transaction_timestamps", 25),
        ("sample_v2_profile_long", 66000),
        ("sample_v2_profile_samples_not_sorted", 66000),
    ],
)
def test_calculate_profile_duration(profile, duration_ms, request) -> None:
    assert _calculate_profile_duration_ms(request.getfixturevalue(profile)) == duration_ms


@pytest.mark.django_db(transaction=True)
@thread_leak_allowlist(reason="django dev server", issue=97036)
class DeobfuscationViaSymbolicator(TransactionTestCase):
    @pytest.fixture(autouse=True)
    def initialize(self, set_sentry_option, live_server):
        with set_sentry_option("system.url-prefix", live_server.url):
            # Run test case
            yield

    def upload_proguard_mapping(self, uuid, mapping_file_content):
        url = reverse(
            "sentry-api-0-dsym-files",
            kwargs={
                "organization_id_or_slug": self.project.organization.slug,
                "project_id_or_slug": self.project.slug,
            },
        )

        self.login_as(user=self.user)

        out = BytesIO()
        f = zipfile.ZipFile(out, "w")
        f.writestr("proguard/%s.txt" % uuid, mapping_file_content)
        f.writestr("ignored-file.txt", b"This is just some stuff")
        f.close()

        response = self.client.post(
            url,
            {
                "file": SimpleUploadedFile(
                    "symbols.zip", out.getvalue(), content_type="application/zip"
                )
            },
            format="multipart",
        )

        assert response.status_code == 201, response.content
        assert len(response.json()) == 1

    @requires_symbolicator
    def test_basic_resolving(self) -> None:
        self.upload_proguard_mapping(PROGUARD_UUID, PROGUARD_SOURCE)
        android_profile = load_profile("valid_android_profile.json")
        android_profile.update(
            {
                "project_id": self.project.id,
                "build_id": PROGUARD_UUID,
                "event_id": android_profile["profile_id"],
                "profile": {
                    "methods": [
                        {
                            "class_name": "org.a.b.g$a",
                            "name": "a",
                            "signature": "()V",
                            "source_file": "Something.java",
                            "source_line": 67,
                        },
                        {
                            "class_name": "org.a.b.g$a",
                            "name": "a",
                            "signature": "()Z",
                            "source_file": "Else.java",
                            "source_line": 69,
                        },
                    ],
                },
            }
        )

        _deobfuscate_using_symbolicator(
            self.project,
            android_profile,
            PROGUARD_UUID,
        )

        assert android_profile["profile"]["methods"] == [
            {
                "data": {"deobfuscation_status": "deobfuscated"},
                "name": "getClassContext",
                "class_name": "org.slf4j.helpers.Util$ClassContextSecurityManager",
                "signature": "()",
                "source_file": "Util.java",
                "source_line": 67,
            },
            {
                "data": {"deobfuscation_status": "deobfuscated"},
                "name": "getExtraClassContext",
                "class_name": "org.slf4j.helpers.Util$ClassContextSecurityManager",
                "signature": "(): boolean",
                "source_file": "Util.java",
                "source_line": 69,
            },
        ]

    @requires_symbolicator
    def test_inline_resolving(self) -> None:
        self.upload_proguard_mapping(PROGUARD_INLINE_UUID, PROGUARD_INLINE_SOURCE)
        android_profile = load_profile("valid_android_profile.json")
        android_profile.update(
            {
                "project_id": self.project.id,
                "build_id": PROGUARD_INLINE_UUID,
                "event_id": android_profile["profile_id"],
                "profile": {
                    "methods": [
                        {
                            "class_name": "e.a.c.a",
                            "name": "onClick",
                            "signature": "()V",
                            "source_file": None,
                            "source_line": 2,
                        },
                        {
                            "class_name": "io.sentry.sample.MainActivity",
                            "name": "t",
                            "signature": "()V",
                            "source_file": "MainActivity.java",
                            "source_line": 1,
                        },
                    ],
                },
            }
        )

        _deobfuscate_using_symbolicator(
            self.project,
            android_profile,
            PROGUARD_INLINE_UUID,
        )

        assert android_profile["profile"]["methods"] == [
            {
                "class_name": "io.sentry.sample.-$$Lambda$r3Avcbztes2hicEObh02jjhQqd4",
                "data": {
                    "deobfuscation_status": "deobfuscated",
                },
                "name": "onClick",
                "signature": "()",
                "source_file": "-.java",
                "source_line": 2,
            },
            {
                "class_name": "io.sentry.sample.MainActivity",
                "data": {
                    "deobfuscation_status": "deobfuscated",
                },
                "inline_frames": [
                    {
                        "class_name": "io.sentry.sample.MainActivity",
                        "data": {
                            "deobfuscation_status": "deobfuscated",
                        },
                        "name": "onClickHandler",
                        "signature": "()",
                        "source_file": "MainActivity.java",
                        "source_line": 40,
                    },
                    {
                        "class_name": "io.sentry.sample.MainActivity",
                        "data": {
                            "deobfuscation_status": "deobfuscated",
                        },
                        "name": "foo",
                        "signature": "()",
                        "source_file": "MainActivity.java",
                        "source_line": 44,
                    },
                    {
                        "class_name": "io.sentry.sample.MainActivity",
                        "data": {
                            "deobfuscation_status": "deobfuscated",
                        },
                        "name": "bar",
                        "signature": "()",
                        "source_file": "MainActivity.java",
                        "source_line": 54,
                    },
                ],
                "name": "onClickHandler",
                "signature": "()",
                "source_file": "MainActivity.java",
                "source_line": 40,
            },
        ]

    @requires_symbolicator
    def test_error_on_resolving(self) -> None:
        self.upload_proguard_mapping(PROGUARD_BUG_UUID, PROGUARD_BUG_SOURCE)
        android_profile = load_profile("valid_android_profile.json")
        android_profile.update(
            {
                "build_id": PROGUARD_BUG_UUID,
                "project_id": self.project.id,
                "profile": {
                    "methods": [
                        {
                            "name": "a",
                            "abs_path": None,
                            "class_name": "org.a.b.g$a",
                            "source_file": None,
                            "source_line": 67,
                        },
                        {
                            "name": "a",
                            "abs_path": None,
                            "class_name": "org.a.b.g$a",
                            "source_file": None,
                            "source_line": 69,
                        },
                    ],
                },
            }
        )

        project = Project.objects.get_from_cache(id=android_profile["project_id"])
        obfuscated_frames = android_profile["profile"]["methods"].copy()
        _deobfuscate(android_profile, project)

        assert android_profile["profile"]["methods"] == obfuscated_frames

    @requires_symbolicator
    def test_js_symbolication_set_symbolicated_field(self) -> None:
        release = Release.objects.create(
            organization_id=self.project.organization_id, version="nodeprof123"
        )
        release.add_project(self.project)

        for file in ["embedded.js", "embedded.js.map"]:
            with open(get_fixture_path(f"profiles/{file}"), "rb") as f:
                f1 = File.objects.create(
                    name=file,
                    type="release.file",
                    headers={},
                )
                f1.putfile(f)

            ReleaseFile.objects.create(
                name=f"http://example.com/{f1.name}",
                release_id=release.id,
                organization_id=self.project.organization_id,
                file=f1,
            )

        js_profile = load_profile("valid_js_profile.json")
        js_profile.update(
            {
                "project_id": self.project.id,
                "event_id": js_profile["profile_id"],
                "release": release.version,
                "debug_meta": {"images": []},
            }
        )

        _symbolicate_profile(js_profile, self.project)
        assert js_profile["profile"]["frames"][0].get("data", {}).get("symbolicated", False)


def test_set_frames_platform_sample() -> None:
    js_prof: Profile = {
        "version": "1",
        "platform": "javascript",
        "profile": {
            "frames": [
                {"function": "a"},
                {"function": "b", "platform": "cocoa"},
                {"function": "c"},
            ]
        },
    }
    _set_frames_platform(js_prof)

    platforms = [f["platform"] for f in js_prof["profile"]["frames"]]
    assert platforms == ["javascript", "cocoa", "javascript"]


def test_set_in_app_for_android_v2_frames() -> None:
    profile: Profile = {
        "platform": "android",
        "version": "2",
        "profile": {
            "frames": [
                # Java system frames
                {"platform": "java", "module": "android.app.Activity", "function": "onCreate"},
                {
                    "platform": "java",
                    "module": "androidx.core.app.CoreActivity",
                    "function": "init",
                },
                {
                    "platform": "java",
                    "module": "kotlin.coroutines.Continuation",
                    "function": "resume",
                },
                {"platform": "java", "module": "java.lang.Thread", "function": "run"},
                {"platform": "java", "module": "javax.net.ssl.SSLSocket", "function": "connect"},
                {
                    "platform": "java",
                    "module": "com.android.internal.os.ZygoteInit",
                    "function": "main",
                },
                {
                    "platform": "java",
                    "module": "com.google.android.gms.common.GoogleApiClient",
                    "function": "connect",
                },
                {"platform": "java", "module": "retrofit2.OkHttpCall", "function": "execute"},
                {"platform": "java", "module": "sun.misc.Unsafe", "function": "getObject"},
                {
                    "platform": "java",
                    "module": "kotlinx.coroutines.CoroutineScope",
                    "function": "launch",
                },
                {
                    "platform": "java",
                    "module": "com.motorola.camera.CameraApp",
                    "function": "start",
                },
                # Java app frames
                {
                    "platform": "java",
                    "module": "com.example.myapp.MainActivity",
                    "function": "doWork",
                },
                {"platform": "java", "module": "io.sentry.Sentry", "function": "init"},
                {"platform": "java", "module": "org.apache.http.HttpClient", "function": "execute"},
                # Java frame with no module
                {"platform": "java", "function": "unknownFunction"},
                # Native frames
                {"platform": "native", "function": "__libc_init", "module": "libc.so"},
                {"platform": "native", "function": "main", "module": "app_process64"},
                # Frame with in_app already set by symbolicator
                {
                    "platform": "java",
                    "module": "android.view.View",
                    "function": "draw",
                    "in_app": True,
                },
            ],
            "samples": [],
            "stacks": [],
        },
    }

    _set_in_app_for_android_v2_frames(profile)

    frames = profile["profile"]["frames"]

    # Java system frames -> in_app=False
    assert frames[0]["in_app"] is False  # android.app
    assert frames[1]["in_app"] is False  # androidx.core
    assert frames[2]["in_app"] is False  # kotlin.coroutines
    assert frames[3]["in_app"] is False  # java.lang
    assert frames[4]["in_app"] is False  # javax.net
    assert frames[5]["in_app"] is False  # com.android.internal
    assert frames[6]["in_app"] is False  # com.google.android
    assert frames[7]["in_app"] is False  # retrofit2
    assert frames[8]["in_app"] is False  # sun.misc
    assert frames[9]["in_app"] is False  # kotlinx.coroutines
    assert frames[10]["in_app"] is False  # com.motorola

    # Java app frames -> in_app=True
    assert frames[11]["in_app"] is True  # com.example.myapp
    assert frames[12]["in_app"] is True  # io.sentry
    assert frames[13]["in_app"] is True  # org.apache

    # Java frame with no module -> in_app=True (not a known system package)
    assert frames[14]["in_app"] is True

    # Native frames -> in_app=False
    assert frames[15]["in_app"] is False
    assert frames[16]["in_app"] is False

    # Frame with in_app already set -> preserved
    assert frames[17]["in_app"] is True


def test_set_frames_platform_android() -> None:
    android_prof: Profile = {
        "platform": "android",
        "profile": {
            "methods": [
                {"name": "a"},
                {"name": "b"},
            ]
        },
    }
    _set_frames_platform(android_prof)

    platforms = [m["platform"] for m in android_prof["profile"]["methods"]]
    assert platforms == ["android", "android"]


@patch("sentry.profiles.task._track_outcome")
@patch("sentry.profiles.task._track_duration_outcome")
@patch("sentry.profiles.task._symbolicate_profile")
@patch("sentry.profiles.task._deobfuscate_profile")
@patch("sentry.profiles.task._process_vroomrs_profile")
@django_db_all
@pytest.mark.parametrize(
    "profile",
    ["sample_v1_profile", "sample_v2_profile"],
)
def test_process_profile_task_should_emit_profile_duration_outcome(
    _process_vroomrs_profile,
    _deobfuscate_profile,
    _symbolicate_profile,
    _track_duration_outcome,
    _track_outcome,
    profile,
    organization,
    project,
    request,
):
    _process_vroomrs_profile.return_value = True
    _deobfuscate_profile.return_value = True
    _symbolicate_profile.return_value = True

    profile = request.getfixturevalue(profile)
    profile["organization_id"] = organization.id
    profile["project_id"] = project.id

    process_profile_task(profile=profile)

    assert _track_duration_outcome.call_count == 1

    if "profiler_id" not in profile:
        assert _track_outcome.call_count == 1
        _track_outcome.assert_called_with(
            profile=profile,
            project=project,
            categories=[DataCategory.PROFILE, DataCategory.PROFILE_INDEXED],
            outcome=Outcome.ACCEPTED,
        )
    else:
        assert _track_outcome.call_count == 0


@patch("sentry.quotas.backend.should_emit_profile_duration_outcome")
@patch("sentry.profiles.task._track_outcome")
@patch("sentry.profiles.task._track_duration_outcome")
@patch("sentry.profiles.task._symbolicate_profile")
@patch("sentry.profiles.task._deobfuscate_profile")
@patch("sentry.profiles.task._process_vroomrs_profile")
@django_db_all
@pytest.mark.parametrize(
    "profile",
    ["sample_v1_profile", "sample_v2_profile"],
)
def test_process_profile_task_should_not_emit_profile_duration_outcome(
    _process_vroomrs_profile,
    _deobfuscate_profile,
    _symbolicate_profile,
    _track_duration_outcome,
    _track_outcome,
    should_emit_profile_duration_outcome,
    profile,
    organization,
    project,
    request,
):
    _process_vroomrs_profile.return_value = True
    _deobfuscate_profile.return_value = True
    _symbolicate_profile.return_value = True
    should_emit_profile_duration_outcome.return_value = False

    profile = request.getfixturevalue(profile)
    profile["organization_id"] = organization.id
    profile["project_id"] = project.id

    process_profile_task(profile=profile)

    assert _track_duration_outcome.call_count == 0
    assert should_emit_profile_duration_outcome.call_count == 1
    should_emit_profile_duration_outcome.assert_called_with(
        organization=organization, profile=profile
    )

    if "profiler_id" not in profile:
        assert _track_outcome.call_count == 1
        _track_outcome.assert_called_with(
            profile=profile,
            project=project,
            categories=[DataCategory.PROFILE, DataCategory.PROFILE_INDEXED],
            outcome=Outcome.ACCEPTED,
        )

    else:
        assert _track_outcome.call_count == 0


@patch("sentry.profiles.task._process_vroomrs_profile")
@patch("sentry.profiles.task._symbolicate_profile")
@patch("sentry.models.projectsdk.get_sdk_index")
@pytest.mark.parametrize(
    ["profile", "event_type"],
    [
        ("sample_v1_profile", EventType.PROFILE),
        ("sample_v2_profile", EventType.PROFILE_CHUNK),
    ],
)
@django_db_all
def test_track_latest_sdk(
    get_sdk_index,
    _symbolicate_profile,
    _process_vroomrs_profile,
    profile,
    event_type,
    organization,
    project,
    request,
):
    _process_vroomrs_profile.return_value = True
    _symbolicate_profile.return_value = True
    get_sdk_index.return_value = {
        "sentry.python": {},
    }

    profile = request.getfixturevalue(profile)
    profile["organization_id"] = organization.id
    profile["project_id"] = project.id

    process_profile_task(profile=profile)

    assert (
        ProjectSDK.objects.get(
            project=project,
            event_type=event_type.value,
            sdk_name="sentry.python",
            sdk_version="2.24.1",
        )
        is not None
    )


@patch("sentry.profiles.task._process_vroomrs_profile")
@patch("sentry.profiles.task._symbolicate_profile")
@patch("sentry.models.projectsdk.get_sdk_index")
@pytest.mark.parametrize(
    ["platform", "sdk_name"],
    [
        ("python", "sentry.python"),
        ("cocoa", "sentry.cocoa"),
        ("node", "sentry.javascript.node"),
    ],
)
@django_db_all
def test_unknown_sdk(
    get_sdk_index,
    _symbolicate_profile,
    _process_vroomrs_profile,
    platform,
    sdk_name,
    organization,
    project,
    request,
):
    _process_vroomrs_profile.return_value = True
    _symbolicate_profile.return_value = True
    get_sdk_index.return_value = {
        sdk_name: {},
    }

    profile = request.getfixturevalue("sample_v2_profile")
    profile["organization_id"] = organization.id
    profile["project_id"] = project.id
    profile["platform"] = platform
    del profile["client_sdk"]

    process_profile_task(profile=profile)

    assert (
        ProjectSDK.objects.get(
            project=project,
            event_type=EventType.PROFILE_CHUNK.value,
            sdk_name=sdk_name,
            sdk_version="0.0.0",
        )
        is not None
    )


@patch("sentry.profiles.task._process_vroomrs_profile")
@patch("sentry.profiles.task._symbolicate_profile")
@patch("sentry.models.projectsdk.get_sdk_index")
@django_db_all
def test_track_latest_sdk_with_payload(
    get_sdk_index: Any,
    _symbolicate_profile: Any,
    _process_vroomrs_profile: Any,
    organization: Organization,
    project: Project,
    request: Any,
) -> None:
    _process_vroomrs_profile.return_value = True
    _symbolicate_profile.return_value = True
    get_sdk_index.return_value = {
        "sentry.python": {},
    }
    profile = request.getfixturevalue("sample_v1_profile")
    profile["organization_id"] = organization.id
    profile["project_id"] = project.id

    kafka_payload = {
        "organization_id": organization.id,
        "project_id": project.id,
        "received": "2024-01-02T03:04:05",
        "payload": json.dumps(profile),
    }

    payload = b64encode(msgpack.packb(kafka_payload)).decode("utf-8")

    process_profile_task(payload=payload)

    assert (
        ProjectSDK.objects.get(
            project=project,
            event_type=EventType.PROFILE.value,
            sdk_name="sentry.python",
            sdk_version="2.24.1",
        )
        is not None
    )


@patch("sentry.profiles.task._symbolicate_profile")
@patch("sentry.profiles.task._track_outcome")
@patch("sentry.profiles.task._process_vroomrs_profile")
@django_db_all
@pytest.mark.parametrize(
    ["profile", "category", "sdk_version", "dropped"],
    [
        pytest.param("sample_v1_profile", DataCategory.PROFILE, "2.23.0", False),
        pytest.param("sample_v2_profile", DataCategory.PROFILE_CHUNK, "2.23.0", True),
        pytest.param("sample_v2_profile", DataCategory.PROFILE_CHUNK, "2.24.0", False),
        pytest.param("sample_v2_profile", DataCategory.PROFILE_CHUNK, "2.24.1", False),
    ],
)
def test_deprecated_sdks(
    _process_vroomrs_profile,
    _track_outcome,
    _symbolicate_profile: mock.MagicMock,
    profile,
    category,
    sdk_version,
    dropped,
    organization,
    project,
    request,
):
    profile = request.getfixturevalue(profile)
    profile["organization_id"] = organization.id
    profile["project_id"] = project.id
    profile["client_sdk"] = {
        "name": "sentry.python",
        "version": sdk_version,
    }
    _symbolicate_profile.return_value = True

    with override_options(
        {
            "sdk-deprecation.profile-chunk.python": "2.24.1",
            "sdk-deprecation.profile-chunk.python.hard": "2.24.0",
        }
    ):
        process_profile_task(profile=profile)

    if dropped:
        _process_vroomrs_profile.assert_not_called()
        _track_outcome.assert_called_with(
            profile=profile,
            project=project,
            outcome=Outcome.FILTERED,
            categories=[category],
            reason="deprecated sdk",
        )
    else:
        _process_vroomrs_profile.assert_called()


@patch("sentry.profiles.task._symbolicate_profile")
@patch("sentry.profiles.task._track_outcome")
@patch("sentry.profiles.task._process_vroomrs_profile")
@django_db_all
@pytest.mark.parametrize(
    ["profile", "category", "sdk_version", "dropped"],
    [
        pytest.param("sample_v1_profile", DataCategory.PROFILE, "2.23.0", True),
        pytest.param("sample_v2_profile", DataCategory.PROFILE_CHUNK, "2.23.0", True),
        pytest.param("sample_v2_profile", DataCategory.PROFILE_CHUNK, "2.24.0", False),
        pytest.param("sample_v2_profile", DataCategory.PROFILE_CHUNK, "2.24.1", False),
    ],
)
def test_rejected_sdks(
    _process_vroomrs_profile,
    _track_outcome,
    _symbolicate_profile: mock.MagicMock,
    profile,
    category,
    sdk_version,
    dropped,
    organization,
    project,
    request,
):
    profile = request.getfixturevalue(profile)
    profile["organization_id"] = organization.id
    profile["project_id"] = project.id
    profile["client_sdk"] = {
        "name": "sentry.cocoa",
        "version": sdk_version,
    }
    _symbolicate_profile.return_value = True

    with Feature("organizations:profiling-reject-sdks"):
        with override_options(
            {
                "sdk-deprecation.profile-chunk.cocoa": "2.24.1",
                "sdk-deprecation.profile-chunk.cocoa.hard": "2.24.0",
                "sdk-deprecation.profile-chunk.cocoa.reject": "2.23.1",
                "sdk-deprecation.profile.cocoa.reject": "2.23.1",
            }
        ):
            process_profile_task(profile=profile)

    if dropped:
        _process_vroomrs_profile.assert_not_called()
        _track_outcome.assert_called_with(
            profile=profile,
            project=project,
            outcome=Outcome.FILTERED,
            categories=[category],
            reason="rejected sdk",
        )
    else:
        _process_vroomrs_profile.assert_called()


@patch("sentry.profiles.task._symbolicate_profile")
@patch("sentry.profiles.task._deobfuscate_profile")
@patch("sentry.profiles.task._process_vroomrs_profile")
@django_db_all
@pytest.mark.parametrize(
    "profile",
    ["sample_v1_profile", "sample_v2_profile"],
)
def test_process_profile_task_should_flip_project_flag(
    _process_vroomrs_profile: mock.MagicMock,
    _deobfuscate_profile: mock.MagicMock,
    _symbolicate_profile: mock.MagicMock,
    profile,
    organization,
    project,
    request,
):
    with patch(
        "sentry.receivers.onboarding.record_first_profile",
    ) as mock_record_first_profile:
        first_profile_received.connect(mock_record_first_profile, weak=False)
    _process_vroomrs_profile.return_value = True
    _deobfuscate_profile.return_value = True
    _symbolicate_profile.return_value = True

    profile = request.getfixturevalue(profile)
    profile["organization_id"] = organization.id
    profile["project_id"] = project.id

    assert not project.flags.has_profiles
    process_profile_task(profile=profile)

    mock_record_first_profile.assert_called_once_with(
        signal=first_profile_received,
        sender=Project,
        project=project,
    )
    project.refresh_from_db()
    assert project.flags.has_profiles


@django_db_all
def test_store_raw_profile_stores_compressed_data():
    import zstandard

    from sentry.models.files.utils import get_profiles_storage

    profile: dict[str, Any] = {
        "project_id": 456,
        "chunk_id": "11111111-2222-3333-4444-555555555555",
        "platform": "android",
        "raw_profile_content_type": "perfetto",
    }
    raw_profile = b"fake perfetto binary data"

    with override_options({"profiling.store-raw-perfetto-traces.enabled": True}):
        _store_raw_profile(profile, raw_profile)

    storage = get_profiles_storage()
    path = "profiles/raw/456/11111111-2222-3333-4444-555555555555/perfetto.zstd"
    with storage.open(path) as f:
        decompressed = zstandard.decompress(f.read())
    assert decompressed == raw_profile


@django_db_all
def test_store_raw_profile_skips_when_option_disabled():
    from sentry.models.files.utils import get_profiles_storage

    profile: dict[str, Any] = {
        "project_id": 789,
        "chunk_id": "aaaaaaaa-bbbb-cccc-dddd-ffffffffffff",
        "platform": "android",
        "raw_profile_content_type": "perfetto",
    }
    raw_profile = b"fake perfetto binary data"

    with override_options({"profiling.store-raw-perfetto-traces.enabled": False}):
        _store_raw_profile(profile, raw_profile)

    storage = get_profiles_storage()
    path = "profiles/raw/789/aaaaaaaa-bbbb-cccc-dddd-ffffffffffff/perfetto.zstd"
    assert not storage.exists(path)
