from pathlib import Path
from typing import List, Optional
import os

from .transformers_detector import inspect_transformers_model


def get_huggingface_cache_directories() -> List[Path]:
    directories = []

    user_profile = os.environ.get("USERPROFILE")

    if user_profile:
        profile = Path(user_profile)

        directories.extend([
            profile / ".cache" / "huggingface" / "hub",
            profile / ".cache" / "huggingface",
        ])

    huggingface_home = os.environ.get("HF_HOME")

    if huggingface_home:
        hf_home = Path(huggingface_home)

        directories.extend([
            hf_home,
            hf_home / "hub",
        ])

    transformers_cache = os.environ.get("TRANSFORMERS_CACHE")

    if transformers_cache:
        directories.append(Path(transformers_cache))

    return _unique_paths(directories)


def _unique_paths(paths: List[Path]) -> List[Path]:
    result = []
    seen = set()

    for path in paths:
        try:
            normalized = str(path.resolve()).lower()
        except OSError:
            normalized = str(path).lower()

        if normalized in seen:
            continue

        seen.add(normalized)
        result.append(path)

    return result


def discover_huggingface_models() -> List[dict]:
    discovered = []

    for cache_directory in get_huggingface_cache_directories():
        if not cache_directory.exists() or not cache_directory.is_dir():
            continue

        try:
            children = list(cache_directory.iterdir())
        except OSError:
            continue

        for child in children:
            if not child.is_dir():
                continue

            if not child.name.startswith("models--"):
                continue

            snapshots_directory = child / "snapshots"

            if not snapshots_directory.exists():
                continue

            try:
                snapshots = list(snapshots_directory.iterdir())
            except OSError:
                continue

            for snapshot in snapshots:
                if not snapshot.is_dir():
                    continue

                model = inspect_transformers_model(snapshot)

                if not model:
                    continue

                model_name = child.name.removeprefix("models--")
                model_name = model_name.replace("--", "/")

                model["name"] = model_name
                model["source"] = "huggingface"
                model["runtime"] = "transformers"

                discovered.append(model)

    return discovered