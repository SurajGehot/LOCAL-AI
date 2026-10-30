# transformers_detector.py file
from pathlib import Path
from typing import Optional
import json


SUPPORTED_WEIGHT_EXTENSIONS = {
    ".safetensors",
    ".bin",
    ".pt",
    ".pth",
}


CHAT_MODEL_TYPES = {
    "mistral",
    "mixtral",
    "llama",
    "qwen",
    "qwen2",
    "qwen3",
    "qwen2_moe",
    "gemma",
    "gemma2",
    "gemma3",
    "phi",
    "phi3",
    "phi4",
    "gpt2",
    "gpt_neox",
    "falcon",
    "bloom",
    "opt",
    "mpt",
    "deepseek",
    "deepseek_v2",
    "deepseek_v3",
    "deepseek2",
}


CHAT_ARCHITECTURE_MARKERS = {
    "causallm",
    "forcausallm",
    "lmheadmodel",
}


NON_CHAT_ARCHITECTURE_MARKERS = {
    "forsequenceclassification",
    "fortokenclassification",
    "forquestionanswering",
    "formaskedlm",
    "fornextsentenceprediction",
    "forimageclassification",
    "forsemanticsegmentation",
    "forobjectdetection",
}


def _load_config(directory: Path) -> dict:
    config_file = directory / "config.json"

    if not config_file.exists():
        return {}

    try:
        with config_file.open(
            "r",
            encoding="utf-8",
        ) as file:
            return json.load(file)

    except (
        OSError,
        json.JSONDecodeError,
    ):
        return {}


def _calculate_model_size(directory: Path) -> float:
    total_size = 0

    try:
        for file in directory.iterdir():

            if not file.is_file():
                continue

            if file.suffix.lower() not in SUPPORTED_WEIGHT_EXTENSIONS:
                continue

            try:
                total_size += file.stat().st_size
            except OSError:
                pass

    except OSError:
        return 0.0

    return total_size / (1024 ** 3)


def _is_chat_model(
    config: dict,
    directory: Path,
) -> bool:

    model_type = str(
        config.get("model_type", "")
    ).lower()

    architectures = [
        str(value).lower()
        for value in config.get(
            "architectures",
            [],
        )
    ]

    directory_name = directory.name.lower()

    # ---------------------------------------------------------
    # Explicitly reject known non-chat architectures
    # ---------------------------------------------------------

    for architecture in architectures:

        for marker in NON_CHAT_ARCHITECTURE_MARKERS:

            if marker in architecture:
                return False

    # ---------------------------------------------------------
    # Explicitly recognize causal language models
    # ---------------------------------------------------------

    for architecture in architectures:

        for marker in CHAT_ARCHITECTURE_MARKERS:

            if marker in architecture:
                return True

    # ---------------------------------------------------------
    # Recognize known generative model families
    # ---------------------------------------------------------

    for model_family in CHAT_MODEL_TYPES:

        if model_family in model_type:
            return True

    # ---------------------------------------------------------
    # Some models do not expose useful model_type metadata
    # ---------------------------------------------------------

    chat_name_markers = {
        "instruct",
        "chat",
        "assistant",
        "coder",
    }

    for marker in chat_name_markers:

        if marker in directory_name:
            return True

    return False


def inspect_transformers_model(
    directory: Path,
) -> Optional[dict]:

    if not directory.exists():
        return None

    if not directory.is_dir():
        return None

    config_file = directory / "config.json"

    if not config_file.exists():
        return None

    try:
        files = list(directory.iterdir())

    except (
        OSError,
        PermissionError,
    ):
        return None

    weight_files = [
        file
        for file in files
        if (
            file.is_file()
            and file.suffix.lower()
            in SUPPORTED_WEIGHT_EXTENSIONS
        )
    ]

    if not weight_files:
        return None

    config = _load_config(directory)

    if not config:
        return None

    if not _is_chat_model(
        config,
        directory,
    ):
        return None

    model_type = config.get(
        "model_type"
    )

    architectures = config.get(
        "architectures",
        [],
    )

    size_gb = _calculate_model_size(
        directory
    )

    if any(
        file.suffix.lower() == ".safetensors"
        for file in weight_files
    ):
        model_format = "safetensors"
    else:
        model_format = "pytorch"

    return {
        "name": directory.name,
        "path": str(
            directory.resolve()
        ),
        "source": "transformers",
        "runtime": "transformers",
        "format": model_format,
        "sizeGb": round(
            size_gb,
            2,
        ),
        "modelType": model_type,
        "architectures": architectures,
    }