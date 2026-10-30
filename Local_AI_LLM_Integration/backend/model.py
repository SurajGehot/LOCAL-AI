# model.py file
import os
import sys
import time
from pathlib import Path
from typing import Optional
import gc
import threading

import torch
from transformers import (
    AutoModelForCausalLM,
    AutoTokenizer,
    BitsAndBytesConfig,
    TextIteratorStreamer,
    StoppingCriteria,
     StoppingCriteriaList,
)


def get_default_model_path() -> str:

    environment_path = os.environ.get(
        "LOCAL_AI_MODEL_PATH"
    )

    if environment_path:

        path = Path(environment_path)

        if path.exists():
            return str(path)

    if getattr(sys, "frozen", False):

        application_directory = (
            Path(sys.executable)
            .resolve()
            .parent
        )

        candidates = [
            application_directory
            / "mistral-7b",

            application_directory
            / "models"
            / "mistral-7b",
        ]

        for candidate in candidates:

            if candidate.exists():
                return str(candidate)

    development_candidates = [
        Path(r"D:\mistral-7b"),
    ]

    for candidate in development_candidates:

        if candidate.exists():
            return str(candidate)

    raise FileNotFoundError(
        "No local model was found."
    )


QUANT_CONFIG = BitsAndBytesConfig(
    load_in_4bit=True,
    bnb_4bit_quant_type="nf4",
    bnb_4bit_compute_dtype=torch.float16,
)

class CancellationStoppingCriteria(StoppingCriteria):
    def __init__(self, cancel_event: threading.Event):
        self.cancel_event = cancel_event

    def __call__(self, input_ids, scores, **kwargs):
        return self.cancel_event.is_set()

class MistralModel:

    def __init__(self, model_path: str):

        self.model_path = model_path

        print(
            f"Loading model from: {self.model_path}"
        )

        if torch.cuda.is_available():

            print(
                "CUDA device: "
                + torch.cuda.get_device_name(0)
            )

        else:

            print(
                "CUDA is not available. "
                "Using CPU."
            )

        print("Loading tokenizer...")

        self.tokenizer = (
            AutoTokenizer.from_pretrained(
                self.model_path,
                local_files_only=True,
            )
        )

        print("Loading model...")

        self.model = (
            AutoModelForCausalLM.from_pretrained(
                self.model_path,
                quantization_config=QUANT_CONFIG,
                device_map="auto",
                local_files_only=True,
            )
        )

        self.model.eval()

        print("Model loaded successfully.")

    def build_prompt(self, messages: list[dict]) -> str:
        cleaned_messages = []

        for message in messages:
            role = message["role"]
            content = message["content"].strip()

            if not content:
                continue

            cleaned_messages.append({
                "role": role,
                "content": content,
            })

        if not cleaned_messages:
            raise ValueError("No valid messages were provided.")

        if self.tokenizer.chat_template:
            return self.tokenizer.apply_chat_template(
                cleaned_messages,
                tokenize=False,
                add_generation_prompt=True,
            )

        system_prompt = "\n".join(
            message["content"]
            for message in cleaned_messages
            if message["role"] == "system"
        )

        conversation_messages = [
            message
            for message in cleaned_messages
            if message["role"] != "system"
        ]

        formatted_messages = []
        system_added = False

        for message in conversation_messages:
            if message["role"] == "user":
                content = message["content"]

                if system_prompt and not system_added:
                    content = (
                        "<<SYS>>\n"
                        + system_prompt
                        + "\n<</SYS>>\n\n"
                        + content
                    )
                    system_added = True

                formatted_messages.append(
                    "[INST] " + content + " [/INST]"
                )

            elif message["role"] == "assistant":
                formatted_messages.append(
                    message["content"]
                )

        return "<s>" + " ".join(formatted_messages)

    def generate(
        self,
        messages: list[dict],
        max_tokens=256,
        temperature=0.7,
    ):

        formatted_prompt = self.build_prompt(
            messages
        )

        inputs = self.tokenizer(
            formatted_prompt,
            return_tensors="pt",
            truncation=True,
        )

        if torch.cuda.is_available():

            inputs = {
                key: value.to("cuda")
                for key, value in inputs.items()
            }

        with torch.no_grad():

            outputs = self.model.generate(
                **inputs,
                max_new_tokens=max_tokens,
                do_sample=temperature > 0,
                temperature=temperature,
                top_p=0.9,
                repetition_penalty=1.05,
                pad_token_id=(
                    self.tokenizer.eos_token_id
                ),
                eos_token_id=(
                    self.tokenizer.eos_token_id
                ),
            )

        input_length = (
            inputs["input_ids"].shape[-1]
        )

        generated_tokens = outputs[0][
            input_length:
        ]

        text = self.tokenizer.decode(
            generated_tokens,
            skip_special_tokens=True,
        )

        return text.strip()




_loaded_models: dict[str, MistralModel] = {}


def _normalize_model_path(model_path: str) -> str:
    return os.path.normcase(
        str(Path(model_path).expanduser().resolve())
    )


def get_model(model_path: Optional[str] = None):
    if model_path is None:
        model_path = get_default_model_path()

    model_key = _normalize_model_path(model_path)

    if model_key not in _loaded_models:
        print(f"Loading model into cache: {model_path}")

        loaded_model = MistralModel(model_path)
        _loaded_models[model_key] = loaded_model

    return _loaded_models[model_key]


def get_loaded_transformers_models() -> list[dict]:
    loaded = []

    for model in _loaded_models.values():
        gpu_bytes = 0

        for parameter in model.model.parameters():
            if parameter.device.type == "cuda":
                gpu_bytes += (
                    parameter.numel()
                    * parameter.element_size()
                )

        device_map = getattr(
            model.model,
            "hf_device_map",
            {},
        )

        has_gpu_device = any(
            isinstance(device, int)
            or (
                isinstance(device, str)
                and device.startswith("cuda")
            )
            for device in device_map.values()
        )

        loaded.append({
            "path": model.model_path,
            "loaded": True,
            "inVram": gpu_bytes > 0 or has_gpu_device,
            "vramBytesEstimate": gpu_bytes,
        })

    return loaded


def unload_model(
    model_path: Optional[str] = None,
) -> bool:
    if model_path is None:
        if not _loaded_models:
            return False

        _loaded_models.clear()
    else:
        model_key = _normalize_model_path(model_path)

        if model_key not in _loaded_models:
            return False

        del _loaded_models[model_key]

    gc.collect()

    if torch.cuda.is_available():
        torch.cuda.empty_cache()

    return True



def generate_response(
    messages: list[dict],
    max_tokens=256,
    temperature=0.7,
    model_path: Optional[str] = None,
):
    start_time = time.perf_counter()

    model = get_model(model_path)

    text = model.generate(
        messages=messages,
        max_tokens=max_tokens,
        temperature=temperature,
    )

    generation_time_ms = (
        time.perf_counter() - start_time
    ) * 1000

    return {
        "text": text,
        "model": Path(model.model_path).name,
        "generationTimeMs": round(
            generation_time_ms
        ),
    }


def stream_transformers_response(
    messages: list[dict],
    max_tokens=256,
    temperature=0.7,
    model_path: Optional[str] = None,
    cancel_event: threading.Event | None = None,
):
    if cancel_event is None:
        cancel_event = threading.Event()
    start_time = time.perf_counter()
    model = get_model(model_path)

    formatted_prompt = model.build_prompt(messages)

    inputs = model.tokenizer(
        formatted_prompt,
        return_tensors="pt",
        truncation=True,
    )

    if torch.cuda.is_available():
        inputs = {
            key: value.to("cuda")
            for key, value in inputs.items()
        }

    streamer = TextIteratorStreamer(
        model.tokenizer,
        skip_prompt=True,
        skip_special_tokens=True,
    )

    generation_errors = []

    generation_kwargs = {
        **inputs,
        "streamer": streamer,
        "max_new_tokens": max_tokens,
        "do_sample": temperature > 0,
        "temperature": max(temperature, 1e-5),
        "top_p": 0.9,
        "repetition_penalty": 1.05,
        "pad_token_id": model.tokenizer.eos_token_id,
        "eos_token_id": model.tokenizer.eos_token_id,
        "stopping_criteria": StoppingCriteriaList([CancellationStoppingCriteria(cancel_event)]),
    }

    def run_generation():
        try:
            with torch.no_grad():
                model.model.generate(**generation_kwargs)
        except Exception as error:
            generation_errors.append(error)
            streamer.end()

    worker = threading.Thread(
        target=run_generation,
        daemon=True,
    )
    worker.start()

    try:
        for text in streamer:
            if text:
                yield {
                    "type": "token",
                    "text": text,
                }

        worker.join()

        if generation_errors:
            raise generation_errors[0]

        yield {
            "type": "done",
            "model": Path(model.model_path).name,
            "source": "transformers",
            "generationTimeMs": round(
                (time.perf_counter() - start_time) * 1000
            ),
        }
    finally:
        if worker.is_alive():
            worker.join(timeout=2)