# ollama_client.py file
import json
import requests
import subprocess
import subprocess


def get_free_vram_bytes() -> int | None:
    """
    Return free VRAM in bytes for the first NVIDIA GPU.
    Return None if the memory reading is unavailable.
    """
    try:
        result = subprocess.run(
            [
                "nvidia-smi",
                "--query-gpu=memory.free",
                "--format=csv,noheader,nounits",
            ],
            capture_output=True,
            text=True,
            check=True,
            timeout=5,
        )

        lines = [
            line.strip()
            for line in result.stdout.splitlines()
            if line.strip()
        ]

        if not lines:
            return None

        free_mib = int(lines[0])
        return free_mib * 1024 * 1024

    except (
        OSError,
        subprocess.SubprocessError,
        ValueError,
    ):
        return None


OLLAMA_URL = "http://127.0.0.1:11434"


def check_ollama() -> bool:

    try:

        response = requests.get(
            OLLAMA_URL,
            timeout=2,
        )

        return response.status_code == 200

    except requests.RequestException:

        return False


def generate_ollama_response(
    model: str,
    messages: list[dict],
    temperature: float = 0.7,
    max_tokens: int = 512,
):
    response = requests.post(
        f"{OLLAMA_URL}/api/chat",
        json={
            "model": model,
            "messages": messages,
            "stream": False,
            "options": {
                "temperature": temperature,
                "num_predict": max_tokens,
            },
        },
        timeout=300,
    )

    response.raise_for_status()

    data = response.json()

    return {
        "text": data.get("message", {}).get(
            "content",
            "",
        ).strip(),
        "model": model,
    }



def get_loaded_ollama_models() -> list[dict]:
    """
    Return models currently loaded by Ollama, including GPU VRAM usage
    and whether the model is currently CPU-only.
    """
    try:
        response = requests.get(
            f"{OLLAMA_URL}/api/ps",
            timeout=5,
        )
        response.raise_for_status()
        data = response.json()

    except (requests.RequestException, ValueError) as error:
        raise RuntimeError(
            f"Unable to query Ollama runtime status: {error}"
        ) from error

    loaded_models = []

    for model in data.get("models", []):
        vram_bytes = int(model.get("size_vram") or 0)
        size_bytes = int(model.get("size") or 0)

        loaded_models.append({
            "name": model.get("name"),
            "loaded": True,
            "inVram": vram_bytes > 0,
            "cpuOnly": vram_bytes == 0,
            "sizeBytes": size_bytes,
            "vramBytes": vram_bytes,
            "digest": model.get("digest"),
        })

    return loaded_models



def unload_ollama_model(model_name: str) -> dict:
    """
    Unload a specific model from Ollama memory.
    The model files remain installed.
    """
    model_name = model_name.strip()

    if not model_name:
        raise ValueError("A model name is required.")

    loaded_models = get_loaded_ollama_models()

    target = next(
        (
            model
            for model in loaded_models
            if model["name"] == model_name
        ),
        None,
    )

    if target is None:
        return {
            "released": False,
            "name": model_name,
            "reason": "Model is not currently loaded.",
        }

    try:
        response = requests.post(
            f"{OLLAMA_URL}/api/generate",
            json={
                "model": model_name,
                "keep_alive": 0,
                "stream": False,
            },
            timeout=30,
        )
        response.raise_for_status()

    except requests.RequestException as error:
        raise RuntimeError(
            f"Unable to unload Ollama model "
            f"'{model_name}': {error}"
        ) from error

    return {
        "released": True,
        "name": model_name,
    }


def stream_ollama_response(
    model: str,
    messages: list[dict],
    temperature: float = 0.7,
    max_tokens: int = 512,
):
    with requests.post(
        f"{OLLAMA_URL}/api/chat",
        json={
            "model": model,
            "messages": messages,
            "stream": True,
            "options": {
                "temperature": temperature,
                "num_predict": max_tokens,
            },
        },
        stream=True,
        timeout=(10, 300),
    ) as response:
        response.raise_for_status()

        for line in response.iter_lines(decode_unicode=True):
            if not line:
                continue

            if isinstance(line, bytes):
                line = line.decode("utf-8")

            data = json.loads(line)

            content = data.get("message", {}).get("content", "")
            if content:
                yield content

            if data.get("done", False):
                break