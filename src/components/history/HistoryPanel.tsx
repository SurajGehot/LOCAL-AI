import { useEffect, useState } from "react";

import type { ConversationSummary } from "../../conversation/conversationTypes";

import "./HistoryPanel.css";

export interface HistoryPanelProps {
    open: boolean;
    conversations: ConversationSummary[];
    isLoading?: boolean;
    error?: string;
    selectedConversationId?: string | null;

    onToggle: () => void;
    onSelectConversation?: (
        conversation: ConversationSummary,
    ) => void;
    onNewChat?: () => void;
    onRenameConversation?: (
        conversation: ConversationSummary,
        title: string,
    ) => void;

    onDeleteConversation?: (
        conversation: ConversationSummary,
    ) => void;

}

function getConversationTitle(
    conversation: ConversationSummary,
): string {
    const title =
        conversation.title.trim();

    return title || "Untitled conversation";
}

export function HistoryPanel({
    open,
    conversations,
    isLoading = false,
    error = "",
    selectedConversationId = null,
    onToggle,
    onSelectConversation,
    onNewChat,
    onRenameConversation,
    onDeleteConversation,
}: HistoryPanelProps) {
    const [search, setSearch] = useState("");
    const [
        renamingConversationId,
        setRenamingConversationId,
    ] = useState<string | null>(null);

    const [
        renameValue,
        setRenameValue,
    ] = useState("");

    const [
        deletingConversationId,
        setDeletingConversationId,
    ] = useState<string | null>(null);

    const [
        openMenuConversationId,
        setOpenMenuConversationId,
    ] = useState<string | null>(null);


    useEffect(() => {
        if (!open) {
            setSearch("");
        }
    }, [open]);

    const normalizedSearch = search.trim().toLowerCase();

    const filteredConversations =
        normalizedSearch.length === 0
            ? conversations
            : conversations.filter((conversation) =>
                getConversationTitle(conversation)
                    .toLowerCase()
                    .includes(normalizedSearch),
            );

    function startRename(
        conversation: ConversationSummary,
    ) {
        setRenamingConversationId(
            conversation.id,
        );

        setRenameValue("");

        setTimeout(() => {
            const input =
                document.querySelector<HTMLInputElement>(
                    `[data-rename-id="${conversation.id}"]`,
                );

            input?.focus();
        }, 0);
    }

    function finishRename(
        conversation: ConversationSummary,
    ) {
        const title =
            renameValue.trim();

        if (!title) {
            setRenamingConversationId(null);
            setRenameValue("");
            return;
        }

        onRenameConversation?.(
            conversation,
            title,
        );

        setRenamingConversationId(null);
        setRenameValue("");
    }
    useEffect(() => {
        if (!openMenuConversationId) {
            return;
        }

        function handlePointerDown(
            event: PointerEvent,
        ) {
            const target =
                event.target as HTMLElement | null;

            if (!target) {
                return;
            }

            if (
                target.closest(
                    ".history-item-actions",
                ) ||
                target.closest(
                    ".history-item-actions-button",
                )
            ) {
                return;
            }

            setOpenMenuConversationId(null);
        }

        document.addEventListener(
            "pointerdown",
            handlePointerDown,
        );

        return () => {
            document.removeEventListener(
                "pointerdown",
                handlePointerDown,
            );
        };
    }, [openMenuConversationId]);

    return (
        <>
            {!open && (
                <button
                    type="button"
                    className="history-toggle history-toggle-closed"
                    onClick={onToggle}
                    aria-label="Open conversation history"
                    title="Open history"
                >
                    ‹
                </button>
            )}

            <aside
                className={`history-panel ${open ? "history-panel-open" : ""
                    }`}
                aria-hidden={!open}
            >
                <div className="history-panel-header">
                    <div>
                        <span className="history-panel-label">
                            CONVERSATION
                        </span>

                        <h2>HISTORY</h2>
                    </div>

                    <button
                        type="button"
                        className="history-toggle history-toggle-open"
                        onClick={onToggle}
                        aria-label="Close conversation history"
                        title="Close history"
                    >
                        ›
                    </button>
                </div>

                <button
                    type="button"
                    className="history-new-chat"
                    onClick={onNewChat}
                >
                    <span>＋</span>
                    <span>NEW CHAT</span>
                </button>

                <div className="history-search">
                    <span>⌕</span>

                    <input
                        type="text"
                        value={search}
                        onChange={(event) =>
                            setSearch(event.target.value)
                        }
                        placeholder="SEARCH CONVERSATIONS..."
                        aria-label="Search conversations"
                    />
                </div>

                <div className="history-list">
                    {isLoading ? (
                        <div className="history-state">
                            LOADING HISTORY...
                        </div>
                    ) : error ? (
                        <div className="history-state history-state-error">
                            {error}
                        </div>
                    ) : filteredConversations.length === 0 ? (
                        <div className="history-state">
                            {normalizedSearch
                                ? "NO MATCHING CONVERSATIONS."
                                : "NO SAVED CONVERSATIONS."}
                        </div>
                    ) : (
                        filteredConversations.map(
                            (conversation) => {
                                const selected =
                                    conversation.id ===
                                    selectedConversationId;

                                return (
                                    <div
                                        key={conversation.id}
                                        className={`history-item ${selected
                                            ? "history-item-selected"
                                            : ""
                                            }`}
                                    >
                                        <button
                                            type="button"
                                            className="history-item-main"
                                            onClick={() => {
                                                if (
                                                    renamingConversationId ===
                                                    conversation.id
                                                ) {
                                                    return;
                                                }

                                                onSelectConversation?.(
                                                    conversation,
                                                );
                                            }}
                                        >
                                            <span className="history-item-content">
                                                {renamingConversationId ===
                                                    conversation.id ? (
                                                    <input
                                                        type="text"
                                                        data-rename-id={
                                                            conversation.id
                                                        }
                                                        className="history-item-rename-input"
                                                        value={renameValue}
                                                        onChange={(event) =>
                                                            setRenameValue(
                                                                event.target.value,
                                                            )
                                                        }
                                                        onKeyDown={(event) => {
                                                            if (
                                                                event.key ===
                                                                "Enter"
                                                            ) {
                                                                event.preventDefault();

                                                                finishRename(
                                                                    conversation,
                                                                );
                                                            }

                                                            if (
                                                                event.key ===
                                                                "Escape"
                                                            ) {
                                                                event.preventDefault();

                                                                setRenamingConversationId(
                                                                    null,
                                                                );

                                                                setRenameValue("");
                                                            }
                                                        }}
                                                        onClick={(event) =>
                                                            event.stopPropagation()
                                                        }
                                                        onBlur={() => {
                                                            setRenamingConversationId(
                                                                null,
                                                            );

                                                            setRenameValue("");
                                                        }}
                                                        aria-label="Rename conversation"
                                                    />
                                                ) : (
                                                    <span
                                                        className="history-item-title"
                                                        title={getConversationTitle(
                                                            conversation,
                                                        )}
                                                    >
                                                        {getConversationTitle(
                                                            conversation,
                                                        )}
                                                    </span>
                                                )}

                                                <span className="history-item-meta">
                                                    {conversation.messageCount}{" "}
                                                    {conversation.messageCount ===
                                                        1
                                                        ? "MESSAGE"
                                                        : "MESSAGES"}
                                                </span>
                                            </span>
                                        </button>

                                        <button
                                            type="button"
                                            className={`history-item-actions-button ${openMenuConversationId ===
                                                    conversation.id
                                                    ? "history-item-actions-button-active"
                                                    : ""
                                                }`}
                                            onPointerDown={(event) => {
                                                event.stopPropagation();
                                            }}
                                            onClick={(event) => {
                                                event.stopPropagation();

                                                setOpenMenuConversationId(
                                                    (current) =>
                                                        current === conversation.id
                                                            ? null
                                                            : conversation.id,
                                                );
                                            }}
                                            aria-label={`Actions for ${getConversationTitle(
                                                conversation,
                                            )}`}
                                            aria-expanded={
                                                openMenuConversationId ===
                                                conversation.id
                                            }
                                        >
                                            <span aria-hidden="true">
                                                ⋮
                                            </span>
                                        </button>

                                        {openMenuConversationId ===
                                            conversation.id && (
                                                <div
                                                    className="history-item-actions"
                                                    onPointerDown={(event) =>
                                                        event.stopPropagation()
                                                    }
                                                    onClick={(event) =>
                                                        event.stopPropagation()
                                                    }
                                                >
                                                    <button
                                                        type="button"
                                                        className="history-action-rename"
                                                        onClick={() => {
                                                            setOpenMenuConversationId(
                                                                null,
                                                            );

                                                            startRename(
                                                                conversation,
                                                            );
                                                        }}
                                                    >
                                                        <span>↗</span>
                                                        <span>RENAME</span>
                                                    </button>

                                                    <button
                                                        type="button"
                                                        className="history-action-delete"
                                                        onClick={() => {
                                                            setOpenMenuConversationId(
                                                                null,
                                                            );

                                                            setDeletingConversationId(
                                                                conversation.id,
                                                            );
                                                        }}
                                                    >
                                                        <span>×</span>
                                                        <span>DELETE</span>
                                                    </button>
                                                </div>
                                            )}
                                    </div>

                                );
                            },
                        )
                    )}
                </div>
            </aside >
            {deletingConversationId && (
                <div
                    className="history-delete-overlay"
                    onMouseDown={(event) => {
                        if (
                            event.target ===
                            event.currentTarget
                        ) {
                            setDeletingConversationId(
                                null,
                            );
                        }
                    }}
                >
                    <div className="history-delete-dialog">
                        <span className="history-panel-label">
                            CONVERSATION
                        </span>

                        <h3>
                            DELETE CONVERSATION?
                        </h3>

                        <p>
                            This conversation will be
                            permanently deleted.
                        </p>

                        <div className="history-delete-actions">
                            <button
                                type="button"
                                onClick={() =>
                                    setDeletingConversationId(
                                        null,
                                    )
                                }
                            >
                                CANCEL
                            </button>

                            <button
                                type="button"
                                className="history-delete-confirm"
                                onClick={() => {
                                    const conversation =
                                        conversations.find(
                                            (item) =>
                                                item.id ===
                                                deletingConversationId,
                                        );

                                    if (conversation) {
                                        onDeleteConversation?.(
                                            conversation,
                                        );
                                    }

                                    setDeletingConversationId(
                                        null,
                                    );
                                }}
                            >
                                DELETE
                            </button>
                        </div>
                    </div>
                </div>
            )
            }
        </>
    );

}