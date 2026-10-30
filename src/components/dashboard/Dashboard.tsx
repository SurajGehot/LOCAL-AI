// Dashboard.tsx file
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";

import type {
  KeyboardEvent,
  PointerEvent,
  ReactNode,
} from "react";

import { open } from "@tauri-apps/plugin-dialog";

import {
  addModelDirectory,
  getModels,
  getModelRuntime,
  releaseModel,
  scanModels,
  selectModel,
} from "../../llm/llmClient";

import type { ModelInfo, ModelRuntimeResponse, } from "../../llm/llmClient";

import "./Dashboard.css";

/* =========================================================
   PUBLIC TYPES
========================================================= */

export interface DashboardHandle {
  getElement: () => HTMLElement | null;
  getSelectedModel: () => ModelInfo | null;
  showModelRequiredMessage: () => void;
  setPrompt: (value: string) => void;

  selectModelByName: (
    modelName: string,
  ) => Promise<void>;
}

export interface ChatMessage {
  question: string;
  answer: string;
}

export interface DashboardProps {
  onSubmit?: (prompt: string) => void;
  messages?: ChatMessage[];
  isProcessing?: boolean;
  onSaveChat?: () => void;
  isSavingChat?: boolean;
  saveChatMessage?: string;
  isChatSaved?: boolean;
  historyOpen?: boolean;
  historyPanel?: ReactNode;
}

/* =========================================================
   MODEL HELPERS
========================================================= */

function isGGUF(model: ModelInfo): boolean {
  const runtime = (
    model.runtime ?? ""
  ).toLowerCase();

  const format = (
    model.format ?? ""
  ).toLowerCase();

  const type = (
    model.type ?? ""
  ).toLowerCase();

  const path = (
    model.path ?? ""
  ).toLowerCase();

  return (
    runtime === "gguf" ||
    format === "gguf" ||
    type === "gguf" ||
    path.endsWith(".gguf")
  );
}

function isSupportedModel(
  model: ModelInfo
): boolean {
  return !isGGUF(model);
}

function getModelIdentity(
  model: ModelInfo
): string {
  if (model.source === "ollama") {
    return `ollama:${model.name}`;
  }

  return `local:${model.path ?? model.name}`;
}

function getRuntimeLabel(
  model: ModelInfo
): string {
  const runtime = (
    model.runtime ?? ""
  ).toLowerCase();

  const source = (
    model.source ?? ""
  ).toLowerCase();

  if (
    runtime === "ollama" ||
    source === "ollama"
  ) {
    return "OLLAMA";
  }

  return "TRANSFORMERS";
}

function getFormatLabel(
  model: ModelInfo
): string {
  if (model.format) {
    return model.format.toUpperCase();
  }

  if (
    model.source === "ollama"
  ) {
    return "OLLAMA";
  }

  return "LOCAL";
}

function getTypeLabel(
  model: ModelInfo
): string {
  if (model.architecture) {
    return model.architecture.toUpperCase();
  }

  if (model.type) {
    return model.type.toUpperCase();
  }

  if (
    model.source === "ollama"
  ) {
    return "CHAT MODEL";
  }

  return "LOCAL MODEL";
}

function getSourceLabel(
  model: ModelInfo
): string {
  const source = (
    model.source ?? ""
  ).toLowerCase();

  switch (source) {
    case "ollama":
      return "LOCAL OLLAMA";

    case "huggingface":
      return "HUGGING FACE";

    case "local":
      return "LOCAL MODEL";

    default:
      return source
        ? source.toUpperCase()
        : "LOCAL MODEL";
  }
}

function formatModelSize(
  sizeGb: number
): string {
  if (
    !sizeGb ||
    sizeGb <= 0
  ) {
    return "N/A";
  }

  if (sizeGb < 1) {
    return `${Math.round(
      sizeGb * 1024
    )} MB`;
  }

  return `${sizeGb.toFixed(
    2
  )} GB`;
}

function getShortPath(
  path: string | null
): string {
  if (!path) {
    return "PATH NOT AVAILABLE";
  }

  const normalized =
    path.replace(
      /\\/g,
      "/"
    );

  const parts =
    normalized.split("/");

  if (parts.length <= 3) {
    return path;
  }

  return `.../${parts
    .slice(-2)
    .join("/")}`;
}

/* =========================================================
   MODEL CARD
========================================================= */

interface ModelCardProps {
  runtimeBadge: ModelRuntimeBadge;
  releasing: boolean;
  releaseDisabled: boolean;
  onRelease: () => void;
  model: ModelInfo;
  selected: boolean;
  loading: boolean;
  disabled: boolean;
  onSelect: () => void;
}

function ModelCard({
  model,
  selected,
  loading,
  disabled,
  runtimeBadge,
  releasing,
  releaseDisabled,
  onSelect,
  onRelease,
}: ModelCardProps) {
  const runtime =
    getRuntimeLabel(model);

  const format =
    getFormatLabel(model);

  const type =
    getTypeLabel(model);

  const source =
    getSourceLabel(model);

  return (
    <article
      className={
        "model-card" +
        (selected
          ? " model-card-active"
          : "")
      }
    >
      {/* ================================================
          CARD TOP
      ================================================= */}

      <div className="model-card-top">

        <div className="model-card-state">

          <span
            className={
              "model-card-state-dot" +
              (selected
                ? " active"
                : "")
            }
          />

          <span>
            {runtimeBadge}
          </span>

        </div>

        <span
          className={
            "model-card-runtime" +
            (
              runtime ===
                "OLLAMA"
                ? " ollama"
                : " transformers"
            )
          }
        >
          {runtime}
        </span>

      </div>

      {/* ================================================
          MODEL NAME
      ================================================= */}

      <div
        className="model-card-name"
        title={model.name}
      >
        {model.name}
      </div>

      <div className="model-card-source">
        {source}
      </div>

      {/* ================================================
          INFORMATION GRID
      ================================================= */}

      <div className="model-card-info-grid">

        <div className="model-card-info">

          <span>
            SIZE
          </span>

          <strong>
            {formatModelSize(
              model.sizeGb
            )}
          </strong>

        </div>

        <div className="model-card-info">

          <span>
            FORMAT
          </span>

          <strong>
            {format}
          </strong>

        </div>

        <div className="model-card-info">

          <span>
            TYPE
          </span>

          <strong
            title={type}
          >
            {type}
          </strong>

        </div>

      </div>

      {/* ================================================
          PATH
      ================================================= */}

      <div className="model-card-path">

        <span>
          LOCATION
        </span>

        <strong
          title={
            model.path ??
            "Path not available"
          }
        >
          {getShortPath(
            model.path
          )}
        </strong>

      </div>

      {/* ================================================
    CARD FOOTER
    ================================================= */}

      <div className="model-card-footer">
        {selected ? (
          <>
            <div className="model-card-status active">
              <span />
              {loading ? "LOADING" : "ACTIVE"}
            </div>

            <div className="model-card-active-label">
              CURRENT MODEL
            </div>
          </>
        ) : (
          <>
            {runtimeBadge === "IN VRAM" ||
              runtimeBadge === "CPU ONLY" ? (
              <button
                type="button"
                className="model-card-release"
                onClick={onRelease}
                disabled={
                  disabled ||
                  releasing ||
                  releaseDisabled ||
                  loading
                }
              >
                {releasing ? "RELEASING..." : "RELEASE"}
              </button>
            ) : (
              <div
                className={
                  "model-card-status" +
                  (loading ? " loading" : "")
                }
              >
                <span />
                {loading ? "LOADING" : runtimeBadge}
              </div>
            )}

            <div className="model-card-actions">
              <button
                type="button"
                className="model-card-select"
                onClick={onSelect}
                disabled={disabled || releasing || releaseDisabled}
              >
                {loading ? "LOADING..." : "SELECT"}
              </button>
            </div>
          </>
        )}
      </div>
    </article>
  );
}


type ModelRuntimeBadge =
  | "ACTIVE"
  | "IN VRAM"
  | "CPU ONLY"
  | "AVAILABLE"
  | "UNKNOWN";

function normalizeRuntimePath(path: string): string {
  return path
    .replace(/\\/g, "/")
    .replace(/\/+$/, "")
    .toLowerCase();
}

function getModelRuntimeBadge(
  model: ModelInfo,
  selected: boolean,
  runtime: ModelRuntimeResponse | null,
): ModelRuntimeBadge {
  if (selected) {
    return "ACTIVE";
  }

  if (!runtime) {
    return "UNKNOWN";
  }

  if (model.source === "ollama") {
    if (!runtime.ollamaStatusKnown) {
      return "UNKNOWN";
    }

    const loadedModel = runtime.ollama.find(
      (item) => item.name === model.name,
    );

    if (!loadedModel?.loaded) {
      return "AVAILABLE";
    }

    return loadedModel.inVram ? "IN VRAM" : "CPU ONLY";
  }

  if (!runtime.transformersStatusKnown || !model.path) {
    return "UNKNOWN";
  }

  const loadedModel = runtime.transformers.find(
    (item) =>
      normalizeRuntimePath(item.path) ===
      normalizeRuntimePath(model.path!),
  );

  if (!loadedModel?.loaded) {
    return "AVAILABLE";
  }

  return loadedModel.inVram ? "IN VRAM" : "CPU ONLY";
}


/* =========================================================
DASHBOARD
========================================================= */

export const Dashboard = forwardRef<
  DashboardHandle,
  DashboardProps
>(
  (
    {
      onSubmit,
      messages = [],
      isProcessing = false,

      onSaveChat,
      isSavingChat = false,
      saveChatMessage = "",

      isChatSaved = false,

      historyOpen = false,
      historyPanel,
    },
    ref
  ) => {


    /* =====================================================
       CORE STATE
    ===================================================== */

    const [prompt, setPrompt] =
      useState("");

    const [promptHeight, setPromptHeight] =
      useState(50);

    const dashboardRef =
      useRef<HTMLElement>(null);

    const responseContentRef =
      useRef<HTMLDivElement>(null);

    const resizeRef =
      useRef<{
        startY: number;
        startHeight: number;
      } | null>(null);

    /* =====================================================
       MODEL STATE
    ===================================================== */

    const [models, setModels] =
      useState<ModelInfo[]>([]);

    const [selectedModel, setSelectedModel] =
      useState<ModelInfo | null>(null);

    const [modelPanelOpen, setModelPanelOpen] =
      useState(false);

    const [isScanning, setIsScanning] =
      useState(false);

    const [isAddingFolder, setIsAddingFolder] =
      useState(false);

    const [selectingModelKey, setSelectingModelKey] =
      useState<string | null>(null);

    const [modelMessage, setModelMessage] =
      useState("");

    const [modelRuntime, setModelRuntime] = useState<ModelRuntimeResponse | null>(null);

    const [releasingModelKey, setReleasingModelKey] = useState<string | null>(null);

    /* =====================================================
       SUPPORTED MODELS
    ===================================================== */

    const supportedModels =
      useMemo(
        () =>
          models.filter(
            isSupportedModel
          ),
        [models]
      );

    /* =====================================================
       SELECTED MODEL KEY
    ===================================================== */

    const selectedModelKey =
      useMemo(
        () =>
          selectedModel
            ? getModelIdentity(
              selectedModel
            )
            : null,
        [selectedModel]
      );

    /* =====================================================
       MODEL DATA APPLICATION
    ===================================================== */

    const applyModelData =
      useCallback(
        (
          modelData: ModelInfo[],
          selected: string | null
        ) => {
          const supported =
            modelData.filter(
              isSupportedModel
            );

          setModels(
            supported
          );

          if (!selected) {
            setSelectedModel(
              null
            );

            return;
          }

          const active =
            supported.find(
              (model) => {
                if (
                  model.source ===
                  "ollama"
                ) {
                  return (
                    model.name ===
                    selected
                  );
                }

                return (
                  model.path ===
                  selected
                );
              }
            );

          setSelectedModel(
            active ?? null
          );
        },
        []
      );

    /* =====================================================
       IMPERATIVE HANDLE
    ===================================================== */

    useImperativeHandle(
      ref,
      () => ({
        getElement: () =>
          dashboardRef.current,

        getSelectedModel: () =>
          selectedModel,

        showModelRequiredMessage:
          () => {
            setModelMessage(
              "Please add or select a local model before sending a prompt."
            );

            setModelPanelOpen(
              true
            );
          },
        selectModelByName: async (
          modelName: string,
        ) => {
          const model =
            models.find(
              (item) => item.name === modelName,
            );

          if (!model) {
            throw new Error(
              `Model "${modelName}" is not available.`,
            );
          }

          setSelectedModel(model);
        },
        setPrompt: (value: string) => {
          setPrompt(value);
        },
      }),
      [selectedModel]
    );

    /* =====================================================
       INITIAL MODEL LOAD
    ===================================================== */

    useEffect(() => {
      let cancelled = false;

      async function loadModels() {
        try {
          const data =
            await getModels();

          if (cancelled) {
            return;
          }

          applyModelData(
            data.models,
            data.selected
          );
        } catch (error) {
          if (cancelled) {
            return;
          }

          console.error(
            "Failed to load models:",
            error
          );

          setModelMessage(
            "Unable to load model registry."
          );
        }
      }

      void loadModels();

      return () => {
        cancelled = true;
      };
    }, [applyModelData]);

    /* =====================================================
   RESPONSE AUTO-SCROLL
    ===================================================== */

    const previousMessageCountRef = useRef(messages.length);

    useEffect(() => {
      const element = responseContentRef.current;

      if (!element) {
        previousMessageCountRef.current = messages.length;
        return;
      }

      const previousCount = previousMessageCountRef.current;
      previousMessageCountRef.current = messages.length;

      if (messages.length <= previousCount) {
        return;
      }

      const entries = element.querySelectorAll<HTMLElement>(
        ".chat-entry",
      );

      const latestEntry = entries[entries.length - 1];

      if (!latestEntry) {
        return;
      }

      const entryTop =
        latestEntry.getBoundingClientRect().top -
        element.getBoundingClientRect().top +
        element.scrollTop;

      element.scrollTop = entryTop;
    }, [messages.length]);
    /* =====================================================
       fetch runtime status
    ===================================================== */

    useEffect(() => {
      if (!modelPanelOpen) {
        return;
      }

      let cancelled = false;
      let requestInProgress = false;

      async function refreshRuntime() {
        if (requestInProgress) {
          return;
        }

        requestInProgress = true;

        try {
          const runtime = await getModelRuntime();

          if (!cancelled) {
            setModelRuntime(runtime);
          }
        } catch (error) {
          if (!cancelled) {
            setModelRuntime(null);
            console.error("Unable to refresh model runtime:", error);
          }
        } finally {
          requestInProgress = false;
        }
      }

      void refreshRuntime();

      const intervalId = window.setInterval(() => {
        void refreshRuntime();
      }, 5000);

      return () => {
        cancelled = true;
        window.clearInterval(intervalId);
      };
    }, [modelPanelOpen]);

    /* =====================================================
       TEMPORARY MESSAGE
    ===================================================== */

    const showModelMessage =
      useCallback(
        (message: string) => {
          setModelMessage(
            message
          );

          window.setTimeout(
            () => {
              setModelMessage(
                (current) =>
                  current ===
                    message
                    ? ""
                    : current
              );
            },
            3000
          );
        },
        []
      );

    /* =====================================================
       PROMPT SUBMIT
    ===================================================== */

    function submitPrompt() {
      const cleanedPrompt =
        prompt.trim();

      if (
        !cleanedPrompt ||
        isProcessing
      ) {
        return;
      }

      if (!selectedModel) {
        setModelMessage(
          "Select a model before sending a prompt."
        );

        setModelPanelOpen(
          true
        );

        return;
      }

      console.log(
        "Prompt submitted:",
        cleanedPrompt
      );

      setPrompt("");

      onSubmit?.(
        cleanedPrompt
      );
    }

    /* =====================================================
       KEYBOARD
    ===================================================== */

    function handleKeyDown(
      event: KeyboardEvent<HTMLTextAreaElement>
    ) {
      if (
        event.key ===
        "Enter" &&
        event.ctrlKey
      ) {
        event.preventDefault();

        submitPrompt();
      }
    }

    /* =====================================================
       RESIZER
    ===================================================== */

    function handleResizeStart(
      event: PointerEvent<HTMLDivElement>
    ) {
      if (isProcessing) {
        return;
      }

      resizeRef.current = {
        startY:
          event.clientY,

        startHeight:
          promptHeight,
      };

      event.currentTarget.setPointerCapture(
        event.pointerId
      );
    }

    function handleResizeMove(
      event: PointerEvent<HTMLDivElement>
    ) {
      if (
        !resizeRef.current
      ) {
        return;
      }

      const delta =
        event.clientY -
        resizeRef.current
          .startY;

      const nextHeight =
        resizeRef.current
          .startHeight +
        (delta /
          Math.max(
            window.innerHeight,
            1
          )) *
        100;

      const clamped =
        Math.min(
          78,
          Math.max(
            22,
            nextHeight
          )
        );

      setPromptHeight(
        clamped
      );
    }

    function handleResizeEnd() {
      resizeRef.current =
        null;
    }

    /* =====================================================
       SELECT MODEL
    ===================================================== */

    async function handleModelSelect(
      model: ModelInfo
    ) {
      if (
        !isSupportedModel(
          model
        )
      ) {
        showModelMessage(
          "This model format is not supported."
        );

        return;
      }

      const key =
        getModelIdentity(
          model
        );

      if (
        selectingModelKey ||
        key === selectedModelKey
      ) {
        return;
      }

      setSelectingModelKey(
        key
      );

      setModelMessage(
        `Loading ${model.name}...`
      );

      try {
        const selected =
          await selectModel(
            model.source ===
              "ollama"
              ? model.name
              : model.path ?? ""
          );

        setSelectedModel(
          selected
        );

        showModelMessage(
          `${selected.name} is now active.`
        );
      } catch (error) {
        console.error(
          "Model selection failed:",
          error
        );

        showModelMessage(
          error instanceof Error
            ? error.message
            : "Unable to select model."
        );
      } finally {
        setSelectingModelKey(
          null
        );
      }
    }

    async function handleReleaseModel(model: ModelInfo) {
      const key = getModelIdentity(model);

      if (
        releasingModelKey !== null ||
        selectingModelKey !== null ||
        isProcessing ||
        selectedModelKey === key
      ) {
        return;
      }

      if (getModelRuntimeBadge(model, false, modelRuntime) !== "IN VRAM") {
        showModelMessage(
          "This model is not confirmed to be using VRAM.",
        );
        return;
      }

      const identifier =
        model.source === "ollama" ? model.name : model.path;

      if (!identifier) {
        showModelMessage("Unable to identify this model.");
        return;
      }

      setReleasingModelKey(key);
      setModelMessage(`Releasing ${model.name}...`);

      try {
        const result = await releaseModel(
          model.source === "ollama" ? "ollama" : "transformers",
          identifier,
        );

        const runtime = await getModelRuntime();
        setModelRuntime(runtime);

        if (result.released) {
          showModelMessage(`${model.name} released successfully.`);
        } else {
          showModelMessage(
            result.reason || `${model.name} was not loaded.`,
          );
        }
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "An unknown error occurred.";

        showModelMessage(`Unable to release ${model.name}: ${message}`);
      } finally {
        setReleasingModelKey(null);
      }
    }

    /* =====================================================
       SCAN MODELS
    ===================================================== */

    async function handleModelScan() {
      if (
        isScanning ||
        isAddingFolder
      ) {
        return;
      }

      setIsScanning(
        true
      );

      setModelMessage(
        "Scanning for supported local models..."
      );

      try {
        const data =
          await scanModels();

        applyModelData(
          data.models,
          data.selected
        );

        const count =
          data.models.filter(
            isSupportedModel
          ).length;

        setModelMessage(
          count === 0
            ? "No supported models found."
            : `Found ${count} supported model${count === 1
              ? ""
              : "s"
            }.`
        );
      } catch (error) {
        console.error(
          "Model scan failed:",
          error
        );

        setModelMessage(
          error instanceof Error
            ? error.message
            : "Model scan failed."
        );
      } finally {
        setIsScanning(
          false
        );
      }
    }

    /* =====================================================
       ADD MODEL DIRECTORY
    ===================================================== */

    async function handleAddModelDirectory() {
      if (
        isAddingFolder ||
        isScanning
      ) {
        return;
      }

      setIsAddingFolder(
        true
      );

      setModelMessage(
        "Choose a model directory..."
      );

      try {
        const selected =
          await open({
            directory: true,
            multiple: false,
            title:
              "Select Model Directory",
          });

        if (
          selected === null
        ) {
          setModelMessage(
            ""
          );

          return;
        }

        if (
          Array.isArray(
            selected
          )
        ) {
          setModelMessage(
            "Please select one directory."
          );

          return;
        }

        const directory =
          selected.trim();

        if (!directory) {
          setModelMessage(
            "No directory selected."
          );

          return;
        }

        console.log(
          "Selected model directory:",
          directory
        );

        setModelMessage(
          "Scanning selected directory..."
        );

        const discovered =
          await addModelDirectory(
            directory
          );

        const data =
          await getModels();

        applyModelData(
          data.models,
          data.selected
        );

        const supportedDiscovered =
          discovered.filter(
            isSupportedModel
          );

        if (
          supportedDiscovered.length ===
          0
        ) {
          setModelMessage(
            "No supported models found in the selected directory."
          );

          return;
        }

        setModelMessage(
          `Added ${supportedDiscovered.length} supported model${supportedDiscovered.length ===
            1
            ? ""
            : "s"
          }.`
        );
      } catch (error) {
        console.error(
          "Model directory selection failed:",
          error
        );

        setModelMessage(
          error instanceof Error
            ? error.message
            : "Unable to add the selected directory."
        );
      } finally {
        setIsAddingFolder(
          false
        );
      }
    }

    /* =====================================================
       RENDER
    ===================================================== */

    return (
      <section
        ref={dashboardRef}
        className={`dashboard ${historyOpen
          ? "dashboard-history-open"
          : ""
          }`}
      >
        {historyPanel}

        {/* =================================================
            HEADER
        ================================================= */}

        <header className="dashboard-header">

          <div className="brand">

            <h1>
              LOCAL AI
            </h1>

            <span>
              PRIVATE INTELLIGENCE
            </span>

          </div>

          <div className="local-indicator">

            <span
              className={
                "local-dot" +
                (
                  isProcessing
                    ? " processing"
                    : ""
                )
              }
            />

            <span>
              LOCAL
            </span>

          </div>

        </header>

        {/* =================================================
            MAIN
        ================================================= */}

        <div className="dashboard-main">

          {/* ===============================================
              SYSTEM PANEL
          =============================================== */}

          <aside className="system-panel">

            <div className="model-block">

              <span className="label">
                ACTIVE MODEL
              </span>

              {selectedModel ? (
                <>
                  <strong
                    title={
                      selectedModel.name
                    }
                  >
                    {
                      selectedModel.name
                    }
                  </strong>

                  <span className="value">
                    {
                      getRuntimeLabel(
                        selectedModel
                      )
                    }

                    {selectedModel.sizeGb >
                      0
                      ? ` · ${formatModelSize(
                        selectedModel.sizeGb
                      )}`
                      : ""}
                  </span>
                </>
              ) : (
                <>
                  <strong>
                    NO MODEL
                  </strong>

                  <span className="value">
                    SELECT A MODEL
                  </span>
                </>
              )}

              <button
                type="button"
                className="model-selector-button"
                onClick={() =>
                  setModelPanelOpen(
                    (value) =>
                      !value
                  )
                }
                aria-expanded={
                  modelPanelOpen
                }
              >
                {modelPanelOpen
                  ? "CLOSE MODELS"
                  : "SELECT MODEL"}
              </button>

              {/* =========================================
                  MODEL CARD PANEL
              ========================================== */}

              {modelPanelOpen && (
                <div className="model-selector-panel">

                  <div className="model-selector-header">

                    <div>

                      <span className="model-selector-title">
                        MODEL LIBRARY
                      </span>

                      <span className="model-selector-subtitle">
                        Local inference runtimes
                      </span>

                    </div>

                    <button
                      type="button"
                      className="model-panel-close"
                      onClick={() =>
                        setModelPanelOpen(
                          false
                        )
                      }
                      aria-label="Close model library"
                    >
                      ×
                    </button>

                  </div>

                  {/* =====================================
                      CARD GRID
                  ====================================== */}

                  <div className="model-card-list">

                    {supportedModels.length ===
                      0 ? (
                      <div className="model-empty">

                        <strong>
                          NO SUPPORTED MODELS
                        </strong>

                        <span>
                          Add a model folder
                          or scan your
                          system to discover
                          supported models.
                        </span>

                      </div>
                    ) : (
                      supportedModels.map(
                        (model) => {
                          const key =
                            getModelIdentity(
                              model
                            );

                          const selected =
                            selectedModelKey ===
                            key;

                          const loading =
                            selectingModelKey ===
                            key;

                          const runtimeBadge = getModelRuntimeBadge(
                            model,
                            selected,
                            modelRuntime,
                          );



                          return (
                            <ModelCard
                              key={key}
                              model={model}
                              selected={
                                selected
                              }
                              loading={
                                loading
                              }
                              disabled={
                                isScanning ||
                                isAddingFolder ||
                                selectingModelKey !==
                                null
                              }
                              runtimeBadge={runtimeBadge}
                              releasing={releasingModelKey === key}
                              releaseDisabled={isProcessing || releasingModelKey !== null}
                              onRelease={() => handleReleaseModel(model)}
                              onSelect={() =>
                                handleModelSelect(
                                  model
                                )
                              }
                            />
                          );
                        }
                      )
                    )}

                  </div>

                  {/* =====================================
                      ACTIONS
                  ====================================== */}

                  <div className="model-selector-footer">

                    <button
                      type="button"
                      className="model-action-button"
                      onClick={
                        handleModelScan
                      }
                      disabled={
                        isScanning ||
                        isAddingFolder
                      }
                    >
                      {isScanning
                        ? "SCANNING..."
                        : "SCAN MODELS"}
                    </button>

                    <button
                      type="button"
                      className="model-action-button primary"
                      onClick={
                        handleAddModelDirectory
                      }
                      disabled={
                        isScanning ||
                        isAddingFolder
                      }
                    >
                      {isAddingFolder
                        ? "ADDING..."
                        : "ADD FOLDER"}
                    </button>

                  </div>

                  {modelMessage && (
                    <div className="model-message">
                      {modelMessage}
                    </div>
                  )}

                </div>
              )}

            </div>

            {/* =============================================
                SYSTEM STATUS
            ============================================== */}

            <div className="system-ready">

              <span
                className={
                  "ready-dot " +
                  (
                    isProcessing
                      ? "processing"
                      : selectedModel
                        ? "ready"
                        : "idle"
                  )
                }
              />

              <div>

                <span>
                  SYSTEM
                </span>

                <strong>
                  {isProcessing
                    ? "PROCESSING"
                    : selectedModel
                      ? "READY"
                      : "NO MODEL"}
                </strong>

              </div>

            </div>

          </aside>

          {/* ===============================================
              INTERACTION PANEL
          =============================================== */}

          <section className="interaction-panel">

            <div
              className="prompt-area"
              style={{
                flex:
                  `0 0 ${promptHeight}%`,
              }}
            >

              <span className="section-label">
                ASK LOCAL AI
              </span>

              <textarea
                className="prompt-input"
                value={prompt}
                onChange={(event) =>
                  setPrompt(
                    event.target.value
                  )
                }
                onKeyDown={
                  handleKeyDown
                }
                placeholder={
                  selectedModel
                    ? "What do you want to know?"
                    : "Select a model first..."
                }
                spellCheck={false}
                disabled={
                  isProcessing
                }
              />

              <div className="submit-area">

                <button
                  className="submit-button"
                  type="button"
                  aria-label="Submit prompt"
                  onClick={
                    submitPrompt
                  }
                  disabled={
                    !prompt.trim() ||
                    isProcessing
                  }
                >
                  ↗
                </button>

                <span>
                  CTRL + ↵
                </span>

              </div>

            </div>

            {/* =============================================
                RESIZER
            ============================================== */}

            <div
              className={
                "panel-resizer" +
                (
                  isProcessing
                    ? " panel-resizer-disabled"
                    : ""
                )
              }
              onPointerDown={
                handleResizeStart
              }
              onPointerMove={
                handleResizeMove
              }
              onPointerUp={
                handleResizeEnd
              }
              onPointerCancel={
                handleResizeEnd
              }
              role="separator"
              aria-orientation="horizontal"
              aria-label="Resize prompt and response panels"
            >
              <span />
            </div>

            {/* =============================================
                RESPONSE
            ============================================== */}

            <div
              className="response-area"
              style={{
                flex:
                  `1 1 ${100 -
                  promptHeight
                  }%`,
              }}
            >

              <div className="response-header">

                <span className="section-label">
                  RESPONSE
                </span>

                <span className="response-state">

                  {isProcessing
                    ? "PROCESSING"
                    : messages.length
                      ? "READY"
                      : "WAITING"}

                  <i />

                </span>

              </div>

              <div
                ref={
                  responseContentRef
                }
                className="response-content"
              >

                {messages.length ===
                  0 ? (
                  <div className="empty-response">
                    Your response will
                    appear here.
                  </div>
                ) : (
                  messages.map(
                    (
                      message,
                      index
                    ) => (
                      <article
                        className="chat-entry"
                        key={`${message.question}-${index}`}
                      >

                        <div className="chat-block">

                          <span className="chat-role">
                            YOU
                          </span>

                          <p className="chat-question">
                            {
                              message.question
                            }
                          </p>

                        </div>

                        <div className="chat-block chat-answer">

                          <span className="chat-role">
                            {
                              selectedModel?.name ??
                              "LOCAL AI"
                            }
                          </span>

                          <p className="chat-response">
                            {
                              message.answer
                            }
                          </p>

                        </div>

                      </article>
                    )
                  )
                )}

              </div>

            </div>

          </section>

        </div>

        {/* =================================================
            FOOTER
        ================================================= */}

        <footer className="dashboard-footer">

          <div>

            <span>
              MODEL
            </span>

            <strong
              title={
                selectedModel?.name ??
                "NO MODEL"
              }
            >
              {
                selectedModel?.name ??
                "NO MODEL"
              }
            </strong>

          </div>

          {!isChatSaved &&
            messages.length > 0 && (
              <button
                type="button"
                onClick={onSaveChat}
                disabled={isSavingChat}
                className="save-chat-button"
              >
                {isSavingChat
                  ? "SAVING..."
                  : "SAVE CHAT TO HISTORY"}
              </button>
            )}

          {saveChatMessage && (
            <span className="save-chat-message">
              {saveChatMessage}
            </span>
          )}

          <div className="footer-message">
            BUILT FOR A MORE PRIVATE TOMORROW
          </div>

        </footer>

      </section>
    );
  }
);

Dashboard.displayName =
  "Dashboard";