// App.tsx file
import {
  useEffect,
  useRef,
  useState,
} from "react";
import {
  createPortal,
} from "react-dom";

import {
  Dashboard,
} from "./components/dashboard/Dashboard";

import type {
  DashboardHandle,
  ChatMessage,
} from "./components/dashboard/Dashboard";

import {
  TransitionView,
} from "./transition/TransitionView";

import type {
  TransitionViewHandle,
} from "./transition/TransitionView";

import type {
  TransitionPhase,
} from "./transition/TransitionController";

import {
  generateResponse,
  cancelGenerationRequest,
} from "./llm/llmClient";

import type {
  ModelInfo,
} from "./llm/llmClient";

import {
  ConversationManager,
} from "./conversation/conversationManager";



import {
  loadConversation,
  loadConversationHistory,
  renameSavedConversation,
  deleteSavedConversation,
  saveCurrentConversation,
} from "./conversation/conversationService";

import type {
  ConversationMessage,
  ConversationSummary,
} from "./conversation/conversationTypes";

import {
  HistoryPanel,
} from "./components/history/HistoryPanel";

import "./App.css";

interface ActiveGeneration {
  conversationId: string;
  manager: ConversationManager;
  answer: string;
  saveToHistory: boolean;
}

function restoreChatMessages(
  conversationMessages: ConversationMessage[],
  pendingAnswer?: string,
): ChatMessage[] {
  const restoredMessages: ChatMessage[] = [];
  let currentQuestion: string | null = null;

  for (const message of conversationMessages) {
    if (message.role === "user") {
      currentQuestion = message.content;
      continue;
    }

    if (
      message.role === "assistant" &&
      currentQuestion !== null
    ) {
      restoredMessages.push({
        question: currentQuestion,
        answer: message.content,
      });

      currentQuestion = null;
    }
  }

  if (currentQuestion !== null && pendingAnswer !== undefined) {
    restoredMessages.push({
      question: currentQuestion,
      answer: pendingAnswer,
    });
  }

  return restoredMessages;
}

function App() {
  console.log("APP RENDERING");

  const dashboardRef =
    useRef<DashboardHandle>(null);

  const transitionRef =
    useRef<TransitionViewHandle>(null);

  const [
    transitionPhase,
    setTransitionPhase,
  ] = useState<TransitionPhase>("IDLE");


  const [
    dashboardElement,
    setDashboardElement,
  ] = useState<HTMLElement | null>(
    null
  );


  const [
    messages,
    setMessages,
  ] = useState<ChatMessage[]>([]);


  const [
    isGenerating,
    setIsGenerating,
  ] = useState(false);

  const [
    activeModel,
    setActiveModel,
  ] = useState<ModelInfo | null>(null);

  const conversationManagerRef =
    useRef<ConversationManager | null>(null);

  const generationAbortRef = useRef<AbortController | null>(null);
  const interruptedPromptRef = useRef<string | null>(null);
  const interruptedEntryRef = useRef(false);
  const activePromptRef = useRef<string | null>(null);
  const activeGenerationRef = useRef<ActiveGeneration | null>(null);
  const historySelectionRequestRef = useRef(0);

  if (!conversationManagerRef.current) {
    conversationManagerRef.current =
      new ConversationManager();
  }

  const [isSavingChat, setIsSavingChat] =
    useState(false);

  const [saveChatMessage, setSaveChatMessage] =
    useState("");

  const [history, setHistory] = useState<ConversationSummary[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);

  async function handleSaveChat() {
    if (isSavingChat) {
      return;
    }

    const manager =
      conversationManagerRef.current;

    if (!manager) {
      return;
    }

    setIsSavingChat(true);
    setSaveChatMessage("");

    try {
      await saveCurrentConversation(manager);

      const activeGeneration =
        activeGenerationRef.current;

      if (activeGeneration?.manager === manager) {
        activeGeneration.saveToHistory = true;
      }

      setSelectedConversationId(
        manager.getId(),
      );

      await refreshHistory();

      setSaveChatMessage(
        "Chat saved to history.",
      );
    } catch (error) {
      console.error(
        "Failed to save chat:",
        error,
      );

      setSaveChatMessage(
        error instanceof Error
          ? error.message
          : "Failed to save chat.",
      );
    } finally {
      setIsSavingChat(false);
    }
  }

  async function handleDashboardSubmit(prompt: string) {
    if (isGenerating) {
      return;
    }
    console.log("Application received prompt:", prompt);

    const selectedModel =
      dashboardRef.current?.getSelectedModel();

    if (!selectedModel) {
      dashboardRef.current?.showModelRequiredMessage();
      return;
    }

    setActiveModel(selectedModel);

    const element =
      dashboardRef.current?.getElement();

    if (!element) {
      console.error("Dashboard element unavailable.");
      return;
    }

    const manager =
      conversationManagerRef.current;

    if (!manager) {
      console.error(
        "Conversation manager unavailable.",
      );
      return;
    }

    manager.setModel(selectedModel.name);
    manager.addUserMessage(prompt);

    const contextMessages = manager.getContextMessages();
    const activeGeneration: ActiveGeneration = {
      conversationId: manager.getId(),
      manager,
      answer: "",
      saveToHistory: selectedConversationId === manager.getId(),
    };
    activeGenerationRef.current = activeGeneration;

    const controller = new AbortController();

    generationAbortRef.current = controller;
    activePromptRef.current = prompt;

    setDashboardElement(element);
    setIsGenerating(true);

    if (interruptedEntryRef.current) {
      setMessages(previousMessages =>
        previousMessages.slice(0, -1),
      );

      interruptedEntryRef.current = false;
      interruptedPromptRef.current = null;
    }

    setMessages(previousMessages => [
      ...previousMessages,
      {
        question: prompt,
        answer: "",
      },
    ]);

    let returnStarted = false;

    const startReturnOnce = () => {
      if (returnStarted) {
        return;
      }

      returnStarted = true;
      transitionRef.current?.startReturn();
    };

    try {
      await new Promise<void>(resolve => {
        requestAnimationFrame(() => {
          transitionRef.current?.startDeparture();
          resolve();
        });
      });
      const result = await generateResponse(
        {
          messages: contextMessages.map(message => ({
            role: message.role,
            content: message.content,
          })),
          maxTokens: 512,
          temperature: 0.7,
        },
        chunk => {
          if (chunk.trim().length > 0) {
            startReturnOnce();
          }

          activeGeneration.answer += chunk;

          setMessages(previousMessages => {
            if (
              conversationManagerRef.current?.getId() !==
                activeGeneration.conversationId ||
              previousMessages.length === 0
            ) {
              return previousMessages;
            }

            const lastIndex = previousMessages.length - 1;

            return previousMessages.map((message, index) =>
              index === lastIndex
                ? {
                  ...message,
                  answer: message.answer + chunk,
                }
                : message,
            );
          });
        },
        controller.signal,
      );
      startReturnOnce();

      console.log(
        `${selectedModel.name} response:`,
        result.text,
      );

      console.log(
        "Generation time:",
        result.generationTimeMs,
        "ms",
      );

      manager.addAssistantMessage(result.text);

      setMessages(previousMessages => {
        if (
          conversationManagerRef.current?.getId() !==
            activeGeneration.conversationId ||
          previousMessages.length === 0
        ) {
          return previousMessages;
        }

        const lastIndex = previousMessages.length - 1;

        return previousMessages.map((message, index) =>
          index === lastIndex
            ? { ...message, answer: result.text }
            : message,
        );
      });

      if (activeGeneration.saveToHistory) {
        await saveCurrentConversation(manager);
        await refreshHistory();
      }
    } catch (error) {
      if (
        error instanceof Error &&
        error.name === "AbortError"
      ) {
        manager.removeLastMessage();

        setMessages(previousMessages =>
          conversationManagerRef.current?.getId() ===
            activeGeneration.conversationId
            ? previousMessages.slice(0, -1)
            : previousMessages,
        );

        startReturnOnce();
        return;
      }

      console.error("LLM generation failed:", error);

      manager.removeLastMessage();

      setMessages(previousMessages => {
        if (
          conversationManagerRef.current?.getId() !==
          activeGeneration.conversationId
        ) {
          return previousMessages;
        }

        if (previousMessages.length === 0) {
          return [
            {
              question: prompt,
              answer: "Unable to generate a response.",
            },
          ];
        }

        const lastIndex = previousMessages.length - 1;

        return previousMessages.map((message, index) =>
          index === lastIndex
            ? {
              ...message,
              answer: "Unable to generate a response.",
            }
            : message,
        );
      });

      startReturnOnce();
    } finally {
      if (generationAbortRef.current === controller) {
        generationAbortRef.current = null;
      }

      activePromptRef.current = null;
      if (activeGenerationRef.current === activeGeneration) {
        activeGenerationRef.current = null;
      }
      setIsGenerating(false);
      setActiveModel(null);
    }
  }

  async function refreshHistory() {
    setIsLoadingHistory(true);
    setHistoryError("");

    try {
      const conversations =
        await loadConversationHistory();

      setHistory(conversations);
    } catch (error) {
      console.error(
        "Failed to load conversation history:",
        error,
      );

      setHistoryError(
        error instanceof Error
          ? error.message
          : "Unable to load conversation history.",
      );
    } finally {
      setIsLoadingHistory(false);
    }
  }

  useEffect(() => {
    void refreshHistory();
  }, []);

  useEffect(() => {
    function handleGlobalKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") {
        return;
      }

      const controller = generationAbortRef.current;

      if (!controller) {
        return;
      }

      event.preventDefault();

      const prompt = activePromptRef.current;

      if (prompt !== null) {
        interruptedPromptRef.current = prompt;
        interruptedEntryRef.current = true;

        dashboardRef.current?.setPrompt(prompt);
      }

      void cancelGenerationRequest().catch(error => {
        console.error(
          "Backend cancellation request failed:",
          error,
        );
      });

      controller.abort();
    }

    window.addEventListener("keydown", handleGlobalKeyDown);

    return () => {
      window.removeEventListener(
        "keydown",
        handleGlobalKeyDown,
      );
    };
  }, []);

  async function handleSelectConversation(
    summary: ConversationSummary,
  ) {
    const requestId = ++historySelectionRequestRef.current;
    const activeGeneration = activeGenerationRef.current;

    if (
      activeGeneration?.conversationId === summary.id
    ) {
      conversationManagerRef.current =
        activeGeneration.manager;
      setSelectedConversationId(summary.id);
      setMessages(
        restoreChatMessages(
          activeGeneration.manager.getMessages(),
          activeGeneration.answer,
        ),
      );
      setHistoryError("");
      return;
    }

    if (
      isGenerating &&
      conversationManagerRef.current?.getId() === summary.id
    ) {
      return;
    }

    try {
      setHistoryError("");

      const conversation =
        await loadConversation(
          summary.id,
        );

      if (requestId !== historySelectionRequestRef.current) {
        return;
      }

      const manager = new ConversationManager();
      manager.loadConversation(
        conversation,
      );
      conversationManagerRef.current = manager;

      setSelectedConversationId(
        conversation.id,
      );

      setMessages(
        restoreChatMessages(conversation.messages),
      );

      if (conversation.model) {
        try {
          await dashboardRef.current?.selectModelByName(
            conversation.model,
          );
        } catch (error) {
          console.warn(
            "Saved model could not be restored:",
            error,
          );
        }
      }

    } catch (error) {
      if (requestId !== historySelectionRequestRef.current) {
        return;
      }

      console.error(
        "Failed to load conversation:",
        error,
      );

      setHistoryError(
        error instanceof Error
          ? error.message
          : "Unable to load conversation.",
      );
    }
  }

  function handleNewChat() {
    if (isGenerating) {
      return;
    }

    conversationManagerRef.current =
      new ConversationManager();

    setMessages([]);

    setSelectedConversationId(null);

    setIsHistoryOpen(false);

    setHistoryError("");

    setSaveChatMessage("");

    setIsSavingChat(false);
  }

  async function handleDeleteConversation(
    conversation: ConversationSummary,
  ) {
    try {
      setHistoryError("");

      await deleteSavedConversation(
        conversation.id,
      );

      const activeGeneration =
        activeGenerationRef.current;

      if (activeGeneration?.conversationId === conversation.id) {
        activeGeneration.saveToHistory = false;
      }

      if (
        selectedConversationId ===
        conversation.id
      ) {
        conversationManagerRef.current =
          new ConversationManager();

        setMessages([]);

        setSelectedConversationId(null);

        setSaveChatMessage("");
        setIsSavingChat(false);
      }

      await refreshHistory();
    } catch (error) {
      console.error(
        "Failed to delete conversation:",
        error,
      );

      setHistoryError(
        error instanceof Error
          ? error.message
          : "Unable to delete conversation.",
      );
    }
  }

  async function handleRenameConversation(
    conversation: ConversationSummary,
    title: string,
  ) {
    try {
      setHistoryError("");

      await renameSavedConversation(
        conversation.id,
        title,
      );

      const activeGeneration =
        activeGenerationRef.current;

      if (activeGeneration?.conversationId === conversation.id) {
        activeGeneration.manager.setTitle(title);
      }

      if (
        selectedConversationId ===
        conversation.id
      ) {
        conversationManagerRef.current?.setTitle(
          title,
        );
      }

      await refreshHistory();
    } catch (error) {
      console.error(
        "Failed to rename conversation:",
        error,
      );

      setHistoryError(
        error instanceof Error
          ? error.message
          : "Unable to rename conversation.",
      );
    }
  }

  return (
    <main>

      <div className="dashboard-layer">
        <Dashboard
          ref={dashboardRef}
          onSubmit={handleDashboardSubmit}
          messages={messages}
          isProcessing={isGenerating}

          onSaveChat={handleSaveChat}
          isSavingChat={isSavingChat}
          saveChatMessage={saveChatMessage}
          isChatSaved={
            selectedConversationId !== null
          }

          historyOpen={isHistoryOpen}

          historyPanel={
            <HistoryPanel
              open={isHistoryOpen}
              conversations={history}
              isLoading={isLoadingHistory}
              error={historyError}
              selectedConversationId={
                selectedConversationId
              }
              onToggle={() => {
                setIsHistoryOpen((open) => {
                  const next = !open;

                  if (next) {
                    void refreshHistory();
                  }

                  return next;
                });
              }}
              onSelectConversation={
                handleSelectConversation
              }
              onNewChat={handleNewChat}
              onRenameConversation={
                handleRenameConversation
              }
              onDeleteConversation={
                handleDeleteConversation
              }
            />
          }
        />
      </div>



      <TransitionView
        ref={transitionRef}
        dashboardElement={
          dashboardElement
        }
        onPhaseChange={setTransitionPhase}
      />


      {isGenerating &&
        transitionPhase === "SPACE" &&
        createPortal(
          <div className="llm-thinking">
            <span className="thinking-mark">
              ✦
            </span>

            <span>
              {activeModel?.name ?? "Local model"} is thinking
            </span>

            <span className="thinking-dots">
              <i />
              <i />
              <i />
            </span>
          </div>,
          document.body
        )}

    </main>
  );
}


export default App;