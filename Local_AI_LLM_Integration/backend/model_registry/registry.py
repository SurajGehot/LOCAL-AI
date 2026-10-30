import json
from pathlib import Path
from typing import Optional


class ModelRegistry:
    def __init__(self, registry_path: Optional[str] = None):
        if registry_path:
            self.registry_path = Path(registry_path)
        else:
            self.registry_path = (
                Path.home()
                / ".local-ai"
                / "model_registry.json"
            )

        self.registry_path.parent.mkdir(
            parents=True,
            exist_ok=True,
        )

        self.data = {
            "models": {},
            "directories": [],
        }

        self.load()

    def load(self):
        if not self.registry_path.exists():
            return

        try:
            with self.registry_path.open(
                "r",
                encoding="utf-8",
            ) as file:
                data = json.load(file)

            if isinstance(data, dict):
                self.data.update(data)

        except (
            OSError,
            json.JSONDecodeError,
        ):
            self.data = {
                "models": {},
                "directories": [],
            }

    def save(self):
        temporary_path = self.registry_path.with_suffix(".tmp")

        with temporary_path.open(
            "w",
            encoding="utf-8",
        ) as file:
            json.dump(
                self.data,
                file,
                indent=2,
            )

        temporary_path.replace(self.registry_path)

    # ---------------------------------------------------------
    # MODELS
    # ---------------------------------------------------------

    def add_model(self, model: dict):
        key = self._model_key(model)

        self.data["models"][key] = model

        self.save()

    def add_models(self, models: list[dict]):
        changed = False

        for model in models:
            key = self._model_key(model)

            if self.data["models"].get(key) != model:
                self.data["models"][key] = model
                changed = True

        if changed:
            self.save()

    def remove_model(self, model: dict):
        key = self._model_key(model)

        if key in self.data["models"]:
            del self.data["models"][key]
            self.save()

    def get_models(self) -> list[dict]:
        return list(self.data["models"].values())

    # ---------------------------------------------------------
    # DIRECTORIES
    # ---------------------------------------------------------

    def add_directory(self, directory: str):
        path = str(
            Path(directory)
            .expanduser()
            .resolve()
        )

        normalized = path.lower()

        existing = {
            str(item).lower()
            for item in self.data["directories"]
        }

        if normalized not in existing:
            self.data["directories"].append(path)
            self.save()

    def remove_directory(self, directory: str):
        try:
            normalized = str(
                Path(directory)
                .expanduser()
                .resolve()
            ).lower()
        except OSError:
            normalized = str(directory).lower()

        self.data["directories"] = [
            item
            for item in self.data["directories"]
            if str(item).lower() != normalized
        ]

        self.save()

    def get_directories(self) -> list[str]:
        return list(self.data["directories"])

    # ---------------------------------------------------------
    # INTERNAL
    # ---------------------------------------------------------

    def _model_key(self, model: dict) -> str:
        source = model.get("source")
        path = model.get("path")
        name = model.get("name")

        if source == "ollama":
            return f"ollama::{name}".lower()

        if path:
            try:
                resolved = str(
                    Path(path)
                    .expanduser()
                    .resolve()
                ).lower()

                return f"{source}::{resolved}"

            except OSError:
                pass

        return f"{source}::{name}".lower()