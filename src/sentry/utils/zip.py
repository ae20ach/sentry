from __future__ import annotations

import contextlib
import os
import shutil
import zipfile
from typing import IO


def is_unsafe_path(path: str) -> bool:
    if os.path.isabs(path):
        return True
    for segment in path.split(os.path.sep):
        if segment == os.path.pardir:
            return True
    return False


def safe_extract_zip(f: str | IO[bytes] | zipfile.ZipFile, path: str) -> None:
    """Safely extract a given zip file to a path.  The zipfile can either
    be an open file or a filename.  If the zip is unsafe an exception is
    raised.
    """
    with contextlib.ExitStack() as ctx:
        if not isinstance(f, zipfile.ZipFile):
            zf = ctx.enter_context(zipfile.ZipFile(f, "r"))
        else:
            zf = f

        members = zf.namelist()
        for member in members:
            # Skip directories
            if member.endswith("/"):
                continue

            if is_unsafe_path(member):
                continue
            dst_path = os.path.join(path, member)
            # Validate the final path is within the extraction directory
            abs_dst_path = os.path.abspath(dst_path)
            abs_base_path = os.path.abspath(path)
            if not abs_dst_path.startswith(abs_base_path + os.sep):
                continue
            os.makedirs(os.path.dirname(dst_path), exist_ok=True)
            with open(dst_path, "wb") as df:
                with zf.open(member) as sf:
                    shutil.copyfileobj(sf, df)
