import os
import threading
import time
import traceback
from pathlib import Path

from llama_cpp import Llama


GGUF_CONTEXT_SIZE = int(
    os.environ.get(
        "LOCAL_AI_GGUF_CONTEXT",
        "4096",
    )
)

GGUF_GPU_LAYERS = int(
    os.environ.get(
        "LOCAL_AI_GGUF_GPU_LAYERS",
        "20",
    )
)

GGUF_BATCH_SIZE = int(
    os.environ.get(
        "LOCAL_AI_GGUF_BATCH",
        "128",
    )
)


class GGUFRuntime:

    def __init__(self):
        self.model = None
        self.model_path = None
        self.lock = threading.Lock()

    def load(self, model_path: str):

        resolved_path = str(
            Path(model_path)
            .expanduser()
            .resolve()
        )

        if not Path(resolved_path).is_file():
            raise FileNotFoundError(
                f"GGUF model not found: {resolved_path}"
            )

        if (
            self.model is not None
            and self.model_path == resolved_path
        ):
            return self.model

        self.unload()

        print()
        print("=" * 60)
        print("GGUF RUNTIME")
        print("=" * 60)
        print(f"Model: {resolved_path}")
        print(f"GPU layers: {GGUF_GPU_LAYERS}")
        print(f"Context: {GGUF_CONTEXT_SIZE}")
        print(f"Batch: {GGUF_BATCH_SIZE}")
        print("=" * 60)

        # -----------------------------------------
        # ATTEMPT 1
        # CUDA GPU OFFLOAD
        # -----------------------------------------

        try:

            print(
                "Attempting GGUF CUDA initialization..."
            )

            self.model = Llama(
                model_path=resolved_path,
                n_ctx=GGUF_CONTEXT_SIZE,
                n_batch=GGUF_BATCH_SIZE,
                n_gpu_layers=GGUF_GPU_LAYERS,

                # Keep this enabled for efficient
                # KV-cache handling.
                offload_kqv=True,

                # Disabled initially because we want
                # maximum compatibility.
                flash_attn=False,

                use_mmap=True,

                verbose=True,
            )

            self.model_path = resolved_path

            print(
                "GGUF CUDA model loaded successfully."
            )

            return self.model

        except Exception as error:

            print()
            print(
                "GGUF CUDA initialization failed."
            )
            print(
                f"Error: {error}"
            )

            traceback.print_exc()

            self.model = None
            self.model_path = None

        # -----------------------------------------
        # ATTEMPT 2
        # CPU FALLBACK
        # -----------------------------------------

        try:

            print()
            print(
                "Falling back to CPU GGUF runtime..."
            )

            self.model = Llama(
                model_path=resolved_path,
                n_ctx=GGUF_CONTEXT_SIZE,
                n_batch=64,
                n_gpu_layers=0,
                offload_kqv=False,
                flash_attn=False,
                use_mmap=True,
                verbose=True,
            )

            self.model_path = resolved_path

            print(
                "GGUF CPU model loaded successfully."
            )

            return self.model

        except Exception as error:

            print()
            print(
                "GGUF CPU initialization also failed."
            )
            print(
                f"Error: {error}"
            )

            traceback.print_exc()

            self.model = None
            self.model_path = None

            raise RuntimeError(
                "Unable to initialize the GGUF model. "
                "Both CUDA and CPU GGUF initialization failed."
            ) from error

    def generate(
        self,
        model_path: str,
        prompt: str,
        max_tokens: int = 256,
        temperature: float = 0.7,
    ):

        start_time = time.perf_counter()

        with self.lock:

            model = self.load(
                model_path
            )

            print()
            print(
                "Generating GGUF response..."
            )

            result = model.create_chat_completion(
                messages=[
                    {
                        "role": "user",
                        "content": prompt.strip(),
                    }
                ],

                max_tokens=max_tokens,

                temperature=temperature,

                top_p=0.9,

                repeat_penalty=1.05,

                stream=False,
            )

        text = (
            result["choices"][0]
            ["message"]
            ["content"]
            .strip()
        )

        generation_time_ms = (
            time.perf_counter()
            - start_time
        ) * 1000

        print(
            "GGUF generation complete."
        )

        return {
            "text": text,
            "model": Path(
                model_path
            ).stem,
            "generationTimeMs": round(
                generation_time_ms
            ),
        }

    def unload(self):

        if self.model is not None:

            try:
                self.model.close()

            except Exception:
                pass

        self.model = None
        self.model_path = None


gguf_runtime = GGUFRuntime()


def generate_gguf_response(
    model_path: str,
    prompt: str,
    max_tokens: int = 256,
    temperature: float = 0.7,
):

    return gguf_runtime.generate(
        model_path=model_path,
        prompt=prompt,
        max_tokens=max_tokens,
        temperature=temperature,
    )