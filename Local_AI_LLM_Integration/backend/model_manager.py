# model_manager.py file
from pathlib import Path
from typing import Optional

from model_discovery import DiscoveryEngine
from model_registry import ModelRegistry


class ModelInfo:

    def __init__(
        self,
        name,
        path,
        model_type,
        size_gb,
        source,
        runtime=None,
        model_format=None,
        architecture=None,
    ):

        self.name = name
        self.path = path
        self.model_type = model_type
        self.size_gb = size_gb
        self.source = source
        self.runtime = runtime or source
        self.model_format = model_format
        self.architecture = architecture

    def to_dict(self):

        return {
            "name": self.name,
            "path": self.path,
            "type": self.model_type,
            "runtime": self.runtime,
            "format": self.model_format,
            "sizeGb": round(
                self.size_gb,
                2,
            ),
            "architecture": self.architecture,
            "source": self.source,
        }


class ModelManager:

    def __init__(self):

        self.discovery_engine = (
            DiscoveryEngine()
        )

        self.registry = (
            ModelRegistry()
        )

        self.models: list[
            ModelInfo
        ] = []

        self.selected_model_path: Optional[
            str
        ] = None

        self.selected_model_source: Optional[
            str
        ] = None

        # Restore registered directories
        for directory in (
            self.registry.get_directories()
        ):

            try:
                self.discovery_engine.add_directory(
                    directory
                )

            except ValueError:
                pass

        # Restore registered models
        self._load_registry_models()
        self.validate_registered_models()

    # =========================================================
    # REGISTRY
    # =========================================================

    def _load_registry_models(self):

        registered_models = (
            self.registry.get_models()
        )

        models = []

        for model in registered_models:

            models.append(
                self._dict_to_model(
                    model
                )
            )

        self.models = (
            self._deduplicate_models(
                models
            )
        )

    def _dict_to_model(
        self,
        model: dict,
    ) -> ModelInfo:

        return ModelInfo(
            name=model.get(
                "name"
            ),
            path=model.get(
                "path"
            ),
            model_type=model.get(
                "modelType",
                model.get("type"),
            ),
            size_gb=model.get(
                "sizeGb",
                0,
            ),
            source=model.get(
                "source"
            ),
            runtime=model.get(
                "runtime"
            ),
            model_format=model.get(
                "format"
            ),
            architecture=(
                model.get(
                    "architecture"
                )
            ),
        )

    # =========================================================
    # FAST DISCOVERY
    # =========================================================

    def discover_fast(self) -> list[ModelInfo]:
        discovered = self.discovery_engine.discover_fast()
        self._merge_discovered(discovered)
        return self.models

    # =========================================================
    # DEEP DISCOVERY
    # =========================================================

    def discover_deep(self) -> list[ModelInfo]:
        discovered = self.discovery_engine.discover_deep()
        self._merge_discovered(discovered)
        return self.models

    def discover_all_models(self) -> list[ModelInfo]:
        self.discover_fast()
        self.discover_deep()
        return self.models

    # =========================================================
    # MERGE
    # =========================================================

    def _merge_discovered(
        self,
        discovered: list[dict],
    ):

        for model in discovered:

            model_info = (
                self._dict_to_model(
                    model
                )
            )

            self.registry.add_model(
                model
            )

            self.models = [
                existing
                for existing in self.models
                if self._model_key(existing)
                != self._model_key(model_info)
            ]

            self.models.append(
                model_info
            )

        self.models = (
            self._deduplicate_models(
                self.models
            )
        )

    # =========================================================
    # MODELS
    # =========================================================

    def get_models(
        self,
    ) -> list[dict]:

        return [
            model.to_dict()
            for model in self.models
        ]

    def select_model(
        self,
        identifier: str,
    ) -> ModelInfo:

        identifier = identifier.strip()

        for model in self.models:

            if model.source == "ollama":

                if model.name == identifier:

                    self.selected_model_source = (
                        "ollama"
                    )

                    self.selected_model_path = (
                        model.name
                    )

                    return model

                continue

            if not model.path:
                continue

            try:

                requested_path = (
                    Path(identifier)
                    .expanduser()
                    .resolve()
                )

                model_path = (
                    Path(model.path)
                    .resolve()
                )

            except OSError:
                continue

            if requested_path == model_path:

                self.selected_model_source = (
                    model.source
                )

                self.selected_model_path = (
                    model.path
                )

                return model

        raise ValueError(
            f"Model not found: {identifier}"
        )

    # =========================================================
    # DIRECTORIES
    # =========================================================

    def add_directory(
        self,
        directory: str,
    ):

        self.discovery_engine.add_directory(
            directory
        )

        self.registry.add_directory(
            directory
        )

        return self.discover_fast()

    def remove_directory(
        self,
        directory: str,
    ):

        self.discovery_engine.remove_directory(
            directory
        )

        self.registry.remove_directory(
            directory
        )

        return self.discover_fast()

    def get_directories(
        self,
    ) -> list[str]:

        return (
            self.discovery_engine
            .get_user_directories()
        )

    # =========================================================
    # SELECTED MODEL
    # =========================================================

    def get_selected_model(
        self,
    ) -> Optional[ModelInfo]:

        if (
            self.selected_model_path
            is None
        ):
            return None

        for model in self.models:

            if (
                model.source
                != self.selected_model_source
            ):
                continue

            if model.source == "ollama":

                if (
                    model.name
                    == self.selected_model_path
                ):
                    return model

            else:

                if (
                    model.path
                    == self.selected_model_path
                ):
                    return model

        return None

    # =========================================================
    # HELPERS
    # =========================================================

    def _model_key(
        self,
        model: ModelInfo,
    ) -> str:

        if model.source == "ollama":

            return (
                f"ollama::{model.name}"
                .lower()
            )

        if model.path:

            try:

                return (
                    f"{model.source}::"
                    f"{Path(model.path).resolve()}"
                ).lower()

            except OSError:
                pass

        return (
            f"{model.source}::{model.name}"
        ).lower()

    def _deduplicate_models(
        self,
        models: list[ModelInfo],
    ) -> list[ModelInfo]:

        result = []

        seen = set()

        for model in models:

            key = self._model_key(
                model
            )

            if key in seen:
                continue

            seen.add(key)

            result.append(
                model
            )

        return result


    def validate_registered_models(self):
        valid_models = []

        for model in self.models:

            if model.source == "ollama":
                valid_models.append(model)
                continue

            if not model.path:
                continue

            path = Path(model.path)

            if not path.exists():
                continue

            if not path.is_dir() and model.runtime != "gguf":
                continue

            valid_models.append(model)

        self.models = valid_models

        return self.models


    def remove_model(self, identifier: str) -> ModelInfo:
        model = self._find_model(identifier)

        if model is None:
            raise ValueError(f"Model not found: {identifier}")

        model_key = self._model_key(model)

        self.models = [
            existing
            for existing in self.models
            if self._model_key(existing) != model_key
        ]

        self.registry.remove_model(model.to_dict())

        if (
            self.selected_model_source == model.source
            and (
                (model.source == "ollama" and self.selected_model_path == model.name)
                or
                (model.source != "ollama" and self.selected_model_path == model.path)
            )
        ):
            self.selected_model_path = None
            self.selected_model_source = None

        return model


    def _find_model(self, identifier: str) -> Optional[ModelInfo]:
        identifier = identifier.strip()

        for model in self.models:

            # Ollama model
            if model.source == "ollama":
                if model.name == identifier:
                    return model
                continue

            # Local filesystem model
            if not model.path:
                continue

            try:
                requested_path = Path(identifier).expanduser().resolve()
                model_path = Path(model.path).resolve()
            except OSError:
                continue

            if requested_path == model_path:
                return model

        return None


    def has_cached_models(self) -> bool:
        return len(self.models) > 0