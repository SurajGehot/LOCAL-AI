// llmClient.ts file
const LLM_API_URL = "http://127.0.0.1:8765";

const HEALTH_TIMEOUT_MS = 5000;
const GENERATION_TIMEOUT_MS = 120000;
const MODEL_REQUEST_TIMEOUT_MS = 10000;
const SCAN_TIMEOUT_MS = 120000;

export type LLMMessageRole =
  "user" | "assistant";

export interface LLMMessage {
  role: LLMMessageRole;
  content: string;
}

export interface GenerateRequest {
  messages: LLMMessage[];
  maxTokens?: number;
  temperature?: number;
}
export interface GenerateResponse {
  text: string;
  model: string;
  generationTimeMs: number;
  source?: string;
}

export interface ModelInfo {
  name: string;
  path: string | null;
  type: string | null;
  runtime: string | null;
  format: string | null;
  sizeGb: number;
  architecture: string | null;
  source: string;
}

export interface ModelsResponse {
  models: ModelInfo[];
  selected: string | null;
}

async function requestWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();

  const timeout = window.setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    window.clearTimeout(timeout);
  }
}

export async function checkLLMHealth(): Promise<boolean> {
  try {
    const response = await requestWithTimeout(
      `${LLM_API_URL}/health`,
      {},
      HEALTH_TIMEOUT_MS
    );

    if (!response.ok) {
      return false;
    }

    const data = await response.json();

    return data.status === "ok";
  } catch {
    return false;
  }
}

export async function getModels(): Promise<ModelsResponse> {
  const response = await requestWithTimeout(
    `${LLM_API_URL}/models`,
    {},
    MODEL_REQUEST_TIMEOUT_MS
  );

  if (!response.ok) {
    throw new Error("Unable to load local models.");
  }

  return response.json();
}

export async function selectModel(
  identifier: string
): Promise<ModelInfo> {
  const response = await requestWithTimeout(
    `${LLM_API_URL}/models/select`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        path: identifier,
      }),
    },
    MODEL_REQUEST_TIMEOUT_MS
  );

  if (!response.ok) {
    let message = "Unable to select model.";

    try {
      const error = await response.json();

      if (error.detail) {
        message = error.detail;
      }
    } catch {
      // Keep default message.
    }

    throw new Error(message);
  }

  const data = await response.json();

  return data.model;
}

export async function scanModels(): Promise<ModelsResponse> {
  const response = await requestWithTimeout(
    `${LLM_API_URL}/models/scan`,
    {
      method: "POST",
    },
    SCAN_TIMEOUT_MS
  );

  if (!response.ok) {
    let message = "Model scan failed.";

    try {
      const error = await response.json();

      if (error.detail) {
        message = error.detail;
      }
    } catch {
      // Keep default message.
    }

    throw new Error(message);
  }

  return response.json();
}

export async function addModelDirectory(
  path: string
): Promise<ModelInfo[]> {
  const response = await requestWithTimeout(
    `${LLM_API_URL}/models/directories`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        path,
      }),
    },
    SCAN_TIMEOUT_MS
  );

  if (!response.ok) {
    let message = "Unable to add model directory.";

    try {
      const error = await response.json();

      if (error.detail) {
        message = error.detail;
      }
    } catch {
      // Keep default message.
    }

    throw new Error(message);
  }

  const data = await response.json();

  return data.models;
}

export async function removeModel(
  identifier: string
): Promise<ModelInfo> {
  const response = await requestWithTimeout(
    `${LLM_API_URL}/models/remove`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        identifier,
      }),
    },
    MODEL_REQUEST_TIMEOUT_MS
  );

  if (!response.ok) {
    let message = "Unable to remove model.";

    try {
      const error = await response.json();

      if (error.detail) {
        message = error.detail;
      }
    } catch {
      // Keep default message.
    }

    throw new Error(message);
  }

  const data = await response.json();

  return data.model;
}


export async function generateResponse(
  request: GenerateRequest,
  onChunk?: (chunk: string) => void,
  signal?: AbortSignal,
): Promise<GenerateResponse> {
  const controller = new AbortController();

  const timeout = window.setTimeout(() => {
    controller.abort();
  }, GENERATION_TIMEOUT_MS);

  const abortFromCaller = () => controller.abort();

  if (signal?.aborted) {
    controller.abort();
  } else {
    signal?.addEventListener("abort", abortFromCaller, {
      once: true,
    });
  }

  try {
    const response = await fetch(`${LLM_API_URL}/generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/x-ndjson",
      },
      body: JSON.stringify({
        messages: request.messages,
        maxTokens: request.maxTokens ?? 256,
        temperature: request.temperature ?? 0.7,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      let message = "Unable to generate a response.";

      try {
        const data = await response.json();
        message = data.detail ?? message;
      } catch {
        // Keep the fallback message if the error body isn't JSON.
      }

      throw new Error(message);
    }

    if (!response.body) {
      throw new Error("The backend did not provide a response stream.");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let text = "";
    let result: GenerateResponse | null = null;

    function processLine(line: string) {
      if (!line.trim()) {
        return;
      }

      const event = JSON.parse(line);

      if (event.type === "token") {
        const chunk = String(event.text ?? "");

        if (chunk) {
          text += chunk;
          onChunk?.(chunk);
        }
      } else if (event.type === "done") {
        result = {
          text,
          model: String(event.model ?? ""),
          source: event.source,
          generationTimeMs: Number(event.generationTimeMs ?? 0),
        };
      } else if (event.type === "error") {
        throw new Error(
          String(event.message ?? "Response generation failed."),
        );
      }
    }

    try {
      while (true) {
        const { value, done } = await reader.read();

        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          processLine(line);
        }
      }

      buffer += decoder.decode();

      if (buffer.trim()) {
        processLine(buffer);
      }
    } finally {
      reader.releaseLock();
    }

    if (!result) {
      throw new Error("The response stream ended before completion.");
    }

    return result;
  } catch (error) {
    if (signal?.aborted) {
      const error = new Error("Response generation cancelled.");
      error.name = "AbortError";
      throw error;
    }
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(
        "Response generation timed out. Try a shorter prompt or a smaller response.",
      );
    }
    throw error;
  } finally {
    signal?.removeEventListener("abort", abortFromCaller);
    window.clearTimeout(timeout);
  }
}


export type RuntimeSource = "transformers" | "ollama";

export interface TransformersRuntimeModel {
  path: string;
  loaded: boolean;
  inVram: boolean;
  vramBytesEstimate: number;
}

export interface OllamaRuntimeModel {
  name: string;
  loaded: boolean;
  inVram: boolean;
  sizeBytes: number;
  vramBytes: number;
  digest: string | null;
}

export interface ModelRuntimeResponse {
  transformers: TransformersRuntimeModel[];
  ollama: OllamaRuntimeModel[];
  transformersStatusKnown: boolean;
  ollamaStatusKnown: boolean;
}

export interface ReleaseModelResponse {
  status: "released" | "unchanged";
  released: boolean;
  identifier?: string;
  name?: string;
  reason?: string | null;
}

async function runtimeRequest<T>(
  endpoint: string,
  options: RequestInit = {},
): Promise<T> {
  const controller = new AbortController();

  const timeoutId = window.setTimeout(() => {
    controller.abort();
  }, 15000);

  try {
    const response = await fetch(`${LLM_API_URL}${endpoint}`, {
      ...options,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...options.headers,
      },
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      const detail =
        typeof data.detail === "string"
          ? data.detail
          : `Request failed with status ${response.status}.`;

      throw new Error(detail);
    }

    return data as T;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("The runtime request timed out.");
    }

    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

export function getModelRuntime(): Promise<ModelRuntimeResponse> {
  return runtimeRequest<ModelRuntimeResponse>("/models/runtime");
}

export function releaseModel(
  source: RuntimeSource,
  identifier: string,
): Promise<ReleaseModelResponse> {
  return runtimeRequest<ReleaseModelResponse>("/models/release", {
    method: "POST",
    body: JSON.stringify({
      source,
      identifier,
    }),
  });
}

export async function cancelGenerationRequest(): Promise<void> {
  const response = await fetch(
    `${LLM_API_URL}/generate/cancel`,
    {
      method: "POST",
    },
  );

  if (!response.ok) {
    throw new Error("Unable to cancel generation.");
  }
}