"use client";
// TODO  MC80OmFIVnBZMlhrdUp2bG43bmx2TG82YlU1amRRPT06N2RjMGNjZmI=

import { useCallback, useEffect, useRef } from "react";
import { useStream } from "@langchain/langgraph-sdk/react";
import {
  type Message,
  type Assistant,
  type Checkpoint,
} from "@langchain/langgraph-sdk";
import { v4 as uuidv4 } from "uuid";
import type { UseStreamThread } from "@langchain/langgraph-sdk/react";
import type { TodoItem } from "@/app/types/types";
import { useClient } from "@/providers/ClientProvider";
import { useQueryState } from "nuqs";
import { ContentBlock } from "@langchain/core/messages";
// FIXME  MS80OmFIVnBZMlhrdUp2bG43bmx2TG82YlU1amRRPT06N2RjMGNjZmI=

export type StateType = {
  messages: Message[];
  todos: TodoItem[];
  files: Record<string, string>;
  email?: {
    id?: string;
    subject?: string;
    page_content?: string;
  };
  ui?: any;
};
// eslint-disable  Mi80OmFIVnBZMlhrdUp2bG43bmx2TG82YlU1amRRPT06N2RjMGNjZmI=

export function useChat({
  activeAssistant,
  onHistoryRevalidate,
  thread,
}: {
  activeAssistant: Assistant | null;
  onHistoryRevalidate?: () => void;
  thread?: UseStreamThread<StateType>;
}) {
  const [threadId, setThreadId] = useQueryState("threadId");
  const client = useClient();

  const revalidateHistoryRef = useRef(onHistoryRevalidate);

  useEffect(() => {
    revalidateHistoryRef.current = onHistoryRevalidate;
  }, [onHistoryRevalidate]);

  const scheduleHistoryRevalidate = useCallback(() => {
    if (typeof window === "undefined") {
      revalidateHistoryRef.current?.();
      return;
    }

    window.setTimeout(() => {
      revalidateHistoryRef.current?.();
    }, 0);
  }, []);

  const stream = useStream<StateType>({
    assistantId: activeAssistant?.assistant_id || "",
    client: client ?? undefined,
    reconnectOnMount: true,
    threadId: threadId ?? null,
    onThreadId: setThreadId,
    defaultHeaders: { "x-auth-scheme": "langsmith" },
    // Enable fetching state history when switching to existing threads
    fetchStateHistory: true,
    // Revalidate thread list after paint to avoid blocking the chat UI
    onFinish: scheduleHistoryRevalidate,
    onError: scheduleHistoryRevalidate,
    onCreated: scheduleHistoryRevalidate,
    experimental_thread: thread,
  });

  const sendMessage = useCallback(
    (
      content: string,
      contentBlocks?: ContentBlock.Multimodal.Data[]
    ) => {
      // Split blocks: images go into content array as image_url format (OpenAI-compatible),
      // PDFs go into additional_kwargs.attachments (backend parses them)
      const imageBlocks = contentBlocks?.filter((b) => b.type === "image") ?? [];
      const pdfBlocks = contentBlocks?.filter((b) => b.type !== "image") ?? [];

      // Convert image blocks to image_url format required by Doubao/OpenAI-compatible APIs
      const imageUrlBlocks = imageBlocks.map((b) => ({
        type: "image_url" as const,
        image_url: {
          url: `data:${b.mimeType};base64,${b.data}`,
        },
      }));

      const messageContent: Message["content"] =
        imageUrlBlocks.length > 0
          ? ([
              ...(content.trim().length > 0
                ? [{ type: "text" as const, text: content }]
                : []),
              ...imageUrlBlocks,
            ] as Message["content"])
          : content;

      const newMessage: Message = {
        id: uuidv4(),
        type: "human",
        content: messageContent,
        ...(pdfBlocks.length > 0
          ? { additional_kwargs: { attachments: pdfBlocks } }
          : {}),
      };
      stream.submit(
        { messages: [newMessage] },
        {
          optimisticValues: (prev) => ({
            messages: [...(prev.messages ?? []), newMessage],
          }),
          config: { ...(activeAssistant?.config ?? {}), recursion_limit: 100 },
        }
      );
      // Update thread list immediately when sending a message
      onHistoryRevalidate?.();
    },
    [stream, activeAssistant?.config, onHistoryRevalidate]
  );

  const runSingleStep = useCallback(
    (
      messages: Message[],
      checkpoint?: Checkpoint,
      isRerunningSubagent?: boolean,
      optimisticMessages?: Message[]
    ) => {
      if (checkpoint) {
        stream.submit(undefined, {
          ...(optimisticMessages
            ? { optimisticValues: { messages: optimisticMessages } }
            : {}),
          config: activeAssistant?.config,
          checkpoint: checkpoint,
          ...(isRerunningSubagent
            ? { interruptAfter: ["tools"] }
            : { interruptBefore: ["tools"] }),
        });
      } else {
        stream.submit(
          { messages },
          { config: activeAssistant?.config, interruptBefore: ["tools"] }
        );
      }
    },
    [stream, activeAssistant?.config]
  );

  const setFiles = useCallback(
    async (files: Record<string, string>) => {
      if (!threadId) return;
      // TODO: missing a way how to revalidate the internal state
      // I think we do want to have the ability to externally manage the state
      await client.threads.updateState(threadId, { values: { files } });
    },
    [client, threadId]
  );

  const continueStream = useCallback(
    (hasTaskToolCall?: boolean) => {
      stream.submit(undefined, {
        config: {
          ...(activeAssistant?.config || {}),
          recursion_limit: 100,
        },
        ...(hasTaskToolCall
          ? { interruptAfter: ["tools"] }
          : { interruptBefore: ["tools"] }),
      });
      // Update thread list when continuing stream
      onHistoryRevalidate?.();
    },
    [stream, activeAssistant?.config, onHistoryRevalidate]
  );

  const markCurrentThreadAsResolved = useCallback(() => {
    stream.submit(null, { command: { goto: "__end__", update: null } });
    // Update thread list when marking thread as resolved
    onHistoryRevalidate?.();
  }, [stream, onHistoryRevalidate]);

  const resumeInterrupt = useCallback(
    (value: any) => {
      stream.submit(null, { command: { resume: value } });
      // Update thread list when resuming from interrupt
      onHistoryRevalidate?.();
    },
    [stream, onHistoryRevalidate]
  );

  const stopStream = useCallback(() => {
    stream.stop();
  }, [stream]);

  return {
    stream,
    todos: stream.values.todos ?? [],
    files: stream.values.files ?? {},
    email: stream.values.email,
    ui: stream.values.ui,
    setFiles,
    messages: stream.messages,
    isLoading: stream.isLoading,
    isThreadLoading: stream.isThreadLoading,
    interrupt: stream.interrupt,
    getMessagesMetadata: stream.getMessagesMetadata,
    sendMessage,
    runSingleStep,
    continueStream,
    stopStream,
    markCurrentThreadAsResolved,
    resumeInterrupt,
  };
}
// TODO  My80OmFIVnBZMlhrdUp2bG43bmx2TG82YlU1amRRPT06N2RjMGNjZmI=
