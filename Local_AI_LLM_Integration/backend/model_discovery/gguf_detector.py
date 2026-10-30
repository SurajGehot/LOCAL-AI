from pathlib import Path
from typing import List


def inspect_gguf_directory(directory: Path) -> List[dict]:
    discovered = []

    if not directory.exists() or not directory.is_dir():
        return discovered

    try:
        files = list(directory.iterdir())
    except (OSError, PermissionError):
        return discovered

    for file in files:
        if not file.is_file():
            continue

        if file.suffix.lower() != ".gguf":
            continue

        try:
            size_gb = file.stat().st_size / (1024 ** 3)
        except OSError:
            size_gb = 0.0

        discovered.append({
            "name": file.stem,
            "path": str(file.resolve()),
            "source": "local",
            "runtime": "gguf",
            "format": "gguf",
            "sizeGb": round(size_gb, 2),
            "modelType": "gguf",
            "architectures": [],
            "capability": "chat",
        })

    return discovered