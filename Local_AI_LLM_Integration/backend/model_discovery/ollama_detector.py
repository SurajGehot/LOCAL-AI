from pathlib import Path
from typing import Optional
import os
import shutil
import subprocess
import time

import requests


OLLAMA_URL = "http://127.0.0.1:11434"

OLLAMA_START_TIMEOUT = 15
OLLAMA_REQUEST_TIMEOUT = 2


def _find_ollama_executable() -> Optional[str]:
    """
    Find the Ollama executable without assuming a single
    installation location.
    """

    # ---------------------------------------------------------
    # 1. PATH
    # ---------------------------------------------------------

    executable = shutil.which("ollama")

    if executable:
        return executable

    # ---------------------------------------------------------
    # 2. Common Windows installation locations
    # ---------------------------------------------------------

    candidates = []

    local_app_data = os.environ.get(
        "LOCALAPPDATA"
    )

    program_files = os.environ.get(
        "PROGRAMFILES"
    )

    program_files_x86 = os.environ.get(
        "PROGRAMFILES(X86)"
    )

    if local_app_data:
        candidates.extend([
            Path(local_app_data)
            / "Programs"
            / "Ollama"
            / "ollama.exe",

            Path(local_app_data)
            / "Ollama"
            / "ollama.exe",
        ])

    if program_files:
        candidates.append(
            Path(program_files)
            / "Ollama"
            / "ollama.exe"
        )

    if program_files_x86:
        candidates.append(
            Path(program_files_x86)
            / "Ollama"
            / "ollama.exe"
        )

    for candidate in candidates:

        if candidate.exists():
            return str(candidate)

    return None


def is_ollama_installed() -> bool:
    return (
        _find_ollama_executable()
        is not None
    )


def is_ollama_running() -> bool:

    try:

        response = requests.get(
            OLLAMA_URL,
            timeout=OLLAMA_REQUEST_TIMEOUT,
        )

        return response.status_code == 200

    except requests.RequestException:

        return False


def start_ollama() -> bool:
    """
    Start Ollama in the background.

    Returns True once the Ollama API becomes available.
    """

    if is_ollama_running():
        return True

    executable = (
        _find_ollama_executable()
    )

    if executable is None:
        return False

    try:

        creation_flags = 0

        if os.name == "nt":

            creation_flags = (
                subprocess.CREATE_NO_WINDOW
            )

        subprocess.Popen(
            [
                executable,
                "serve",
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            stdin=subprocess.DEVNULL,
            creationflags=creation_flags,
            start_new_session=True,
        )

    except (
        OSError,
        subprocess.SubprocessError,
    ):

        return False

    # ---------------------------------------------------------
    # Wait for Ollama API
    # ---------------------------------------------------------

    deadline = (
        time.monotonic()
        + OLLAMA_START_TIMEOUT
    )

    while time.monotonic() < deadline:

        if is_ollama_running():
            return True

        time.sleep(0.25)

    return False


def ensure_ollama_running() -> dict:
    """
    Make sure Ollama is available.

    Returns state information instead of raising an error.
    """

    executable = (
        _find_ollama_executable()
    )

    if executable is None:

        return {
            "installed": False,
            "running": False,
            "started": False,
            "executable": None,
        }

    if is_ollama_running():

        return {
            "installed": True,
            "running": True,
            "started": False,
            "executable": executable,
        }

    started = start_ollama()

    return {
        "installed": True,
        "running": started,
        "started": started,
        "executable": executable,
    }


def discover_ollama_models() -> list[dict]:
    """
    Discover models through the Ollama API only.
    """

    if not is_ollama_running():
        return []

    try:

        response = requests.get(
            f"{OLLAMA_URL}/api/tags",
            timeout=OLLAMA_REQUEST_TIMEOUT,
        )

        response.raise_for_status()

        data = response.json()

    except (
        requests.RequestException,
        ValueError,
    ):

        return []

    discovered = []

    for model in data.get(
        "models",
        [],
    ):

        name = model.get(
            "name"
        )

        if not name:
            continue

        size_bytes = model.get(
            "size",
            0,
        )

        try:

            size_gb = (
                float(size_bytes)
                / (1024 ** 3)
            )

        except (
            TypeError,
            ValueError,
        ):

            size_gb = 0.0

        discovered.append({
            "name": name,
            "path": None,
            "source": "ollama",
            "runtime": "ollama",
            "format": "ollama",
            "sizeGb": round(
                size_gb,
                2,
            ),
            "modelType": None,
            "architectures": [],
            "capability": "chat",
        })

    return discovered