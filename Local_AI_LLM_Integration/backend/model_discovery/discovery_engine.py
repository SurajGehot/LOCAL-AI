# discovery_engine.py file
from pathlib import Path
from typing import List, Set
import os

from .transformers_detector import (
    inspect_transformers_model,
)

from .huggingface_detector import (
    discover_huggingface_models,
)

from .ollama_detector import (
    discover_ollama_models,
    ensure_ollama_running,
)

from .gguf_detector import (
    inspect_gguf_directory,
)


class DiscoveryEngine:

    MAX_SCAN_DEPTH = 5

    SKIP_DIRECTORIES = {
        "node_modules",
        ".git",
        ".venv",
        "venv",
        "__pycache__",
        "AppData",
        "Program Files",
        "Program Files (x86)",
        "$Recycle.Bin",
        "System Volume Information",
        "Windows",
        "ProgramData",
        "WpSystem",
        ".gguf"
    }

    MODEL_DIRECTORY_HINTS = {
        "model",
        "models",
        "llm",
        "llms",
        "ai",
        "huggingface",
        "transformers",
        "weights",
        "checkpoints",
        "checkpoint",
        "gguf",
    }

    def __init__(self):

        self.user_directories: Set[str] = set()

    # =========================================================
    # USER DIRECTORIES
    # =========================================================

    def add_directory(
        self,
        directory: str,
    ):

        path = Path(
            directory
        ).expanduser()

        if not path.exists():
            raise ValueError(
                f"Directory does not exist: {directory}"
            )

        if not path.is_dir():
            raise ValueError(
                f"Path is not a directory: {directory}"
            )

        normalized = str(
            path.resolve()
        ).lower()

        self.user_directories.add(
            normalized
        )

    def remove_directory(
        self,
        directory: str,
    ):

        try:
            normalized = str(
                Path(directory)
                .expanduser()
                .resolve()
            ).lower()

        except OSError:
            normalized = str(
                directory
            ).lower()

        self.user_directories.discard(
            normalized
        )

    def get_user_directories(
        self,
    ) -> List[str]:

        return sorted(
            self.user_directories
        )

    # =========================================================
    # FAST DISCOVERY
    # =========================================================
    def ensure_ollama(self) -> dict:
        return ensure_ollama_running()
    
    def discover_fast(self) -> List[dict]:

        models = []

        models.extend(
            discover_huggingface_models()
        )

        ollama_state = (
            self.ensure_ollama()
        )

        if ollama_state["running"]:

            models.extend(
                discover_ollama_models()
            )

        models.extend(
            self._discover_common_model_directories()
        )

        models.extend(
            self._discover_user_directories()
        )

        models.extend(
            self._discover_drive_root_models()
        )

        return self._deduplicate(
            models
        )

    # =========================================================
    # DEEP DISCOVERY
    # =========================================================

    def discover_deep(self) -> List[dict]:

        models = []

        roots = self._get_drive_roots()

        models.extend(
            self._scan_directories(
                roots
            )
        )

        return self._deduplicate(
            models
        )

    # =========================================================
    # COMMON LOCATIONS
    # =========================================================

    def _discover_common_model_directories(
        self,
    ) -> List[dict]:

        directories = []

        user_profile = os.environ.get(
            "USERPROFILE"
        )

        if user_profile:

            profile = Path(
                user_profile
            )

            directories.extend([
                profile / "Models",
                profile / "models",
                profile / "Documents" / "Models",
                profile / "Downloads",
                profile / "AI",
                profile / "AI" / "Models",
            ])

        home = Path.home()

        directories.extend([
            home / "Models",
            home / "models",
        ])

        # Common D: locations
        d_drive = Path("D:/")

        if d_drive.exists():

            directories.extend([
                d_drive / "Models",
                d_drive / "models",
                d_drive / "AI",
                d_drive / "AI" / "Models",
                d_drive / "LLM",
                d_drive / "LLMs",
                d_drive / "HuggingFace",
                d_drive / "HuggingFace" / "Models",
            ])

        return self._scan_directories(
            directories
        )

    def _discover_drive_root_models(self) -> List[dict]:

        discovered = []

        for drive in [
            "C:/",
            "D:/",
        ]:

            root = Path(drive)

            if not root.exists():
                continue

            try:
                children = list(root.iterdir())
            except (
                OSError,
                PermissionError,
            ):
                continue

            for child in children:

                if not child.is_dir():
                    continue

                if child.name in self.SKIP_DIRECTORIES:
                    continue

                model = inspect_transformers_model(
                    child
                )

                if model:
                    discovered.append(model)

                discovered.extend(
                    inspect_gguf_directory(
                        child
                    )
                )

        return discovered

    # =========================================================
    # USER DIRECTORIES
    # =========================================================

    def _discover_user_directories(
        self,
    ) -> List[dict]:

        directories = [
            Path(directory)
            for directory
            in self.user_directories
        ]

        return self._scan_directories(
            directories
        )

    # =========================================================
    # DRIVE ROOTS
    # =========================================================

    def _get_drive_roots(
        self,
    ) -> List[Path]:

        roots = []

        for drive in [
            "C:/",
            "D:/",
        ]:

            path = Path(drive)

            if path.exists():
                roots.append(path)

        return roots

    # =========================================================
    # DIRECTORY SCANNER
    # =========================================================

    def _scan_directories(
        self,
        directories: List[Path],
    ) -> List[dict]:

        discovered = []
        visited = set()

        for directory in directories:
            try:
                self._scan_directory(
                    directory=directory,
                    discovered=discovered,
                    visited=visited,
                    depth=0,
                )
            except Exception as error:
                print(
                    f"Skipping root directory: {directory}"
                )
                print(
                    f"Discovery error: {error}"
                )

        return discovered


    def _scan_directory(
        self,
        directory: Path,
        discovered: List[dict],
        visited: Set[str],
        depth: int,
    ):
        try:
            self._scan_directory_safe(
                directory=directory,
                discovered=discovered,
                visited=visited,
                depth=depth,
            )

        except Exception as error:
            print(
                f"Skipping directory: {directory}"
            )
            print(
                f"Discovery error: {error}"
            )


    def _scan_directory_safe(
        self,
        directory: Path,
        discovered: List[dict],
        visited: Set[str],
        depth: int,
    ):
        if depth > self.MAX_SCAN_DEPTH:
            return

        if not directory.exists():
            return

        if not directory.is_dir():
            return

        try:
            normalized = str(
                directory.resolve()
            ).lower()
        except Exception:
            return

        if normalized in visited:
            return

        visited.add(normalized)

        # --------------------------------------------------
        # Check for Transformers model
        # --------------------------------------------------

        try:
            model = inspect_transformers_model(
                directory
            )

            if model:
                discovered.append(model)

        except Exception as error:
            print(
                f"Transformer inspection skipped: {directory}"
            )
            print(
                f"Discovery error: {error}"
            )

        # --------------------------------------------------
        # Check for GGUF model
        # --------------------------------------------------

        try:
            gguf_models = inspect_gguf_directory(
                directory
            )

            discovered.extend(
                gguf_models
            )

        except Exception as error:
            print(
                f"GGUF inspection skipped: {directory}"
            )
            print(
                f"Discovery error: {error}"
            )

        # --------------------------------------------------
        # Read children
        # --------------------------------------------------

        try:
            children = list(
                directory.iterdir()
            )

        except Exception as error:
            print(
                f"Cannot read directory: {directory}"
            )
            print(
                f"Discovery error: {error}"
            )
            return

        children.sort(
            key=lambda child: (
                0
                if child.name.lower()
                in self.MODEL_DIRECTORY_HINTS
                else 1,
                child.name.lower(),
            )
        )

        # --------------------------------------------------
        # Recurse
        # --------------------------------------------------

        for child in children:

            try:
                if not child.is_dir():
                    continue

                if child.name in self.SKIP_DIRECTORIES:
                    continue

                if (
                    child.name.startswith(".")
                    and child.name != ".cache"
                ):
                    continue

                self._scan_directory(
                    directory=child,
                    discovered=discovered,
                    visited=visited,
                    depth=depth + 1,
                )

            except Exception as error:
                print(
                    f"Skipping child: {child}"
                )
                print(
                    f"Discovery error: {error}"
                )
                continue

    # =========================================================
    # DEDUPLICATION
    # =========================================================

    def _deduplicate(
        self,
        models: List[dict],
    ) -> List[dict]:

        result = []

        seen = set()

        for model in models:

            source = model.get(
                "source"
            )

            path = model.get(
                "path"
            )

            name = model.get(
                "name"
            )

            if source == "ollama":

                key = (
                    "ollama",
                    name,
                )

            else:

                try:

                    key = (
                        source,
                        str(
                            Path(path)
                            .resolve()
                        ).lower(),
                    )

                except (
                    OSError,
                    TypeError,
                ):

                    key = (
                        source,
                        path,
                    )

            if key in seen:
                continue

            seen.add(key)

            result.append(
                model
            )

        return result


    def ensure_ollama(self) -> dict:
        return ensure_ollama_running()