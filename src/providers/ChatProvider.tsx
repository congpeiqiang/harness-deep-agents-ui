"use client";

import { ReactNode, createContext, useContext } from "react";
import { Assistant } from "@langchain/langgraph-sdk";
import { type StateType, useChat } from "@/app/hooks/useChat";
import type { UseStreamThread } from "@langchain/langgraph-sdk/react";
// @ts-expect-error  MC8yOmFIVnBZMlhrdUp2bG43bmx2TG82VGpKWVlnPT06ZDUzYzgyYzI=

interface ChatProviderProps {
  children: ReactNode;
  activeAssistant: Assistant | null;
  onHistoryRevalidate?: () => void;
  thread?: UseStreamThread<StateType>;
}

export function ChatProvider({
  children,
  activeAssistant,
  onHistoryRevalidate,
  thread,
}: ChatProviderProps) {
  const chat = useChat({ activeAssistant, onHistoryRevalidate, thread });
  return <ChatContext.Provider value={chat}>{children}</ChatContext.Provider>;
}

export type ChatContextType = ReturnType<typeof useChat>;

export const ChatContext = createContext<ChatContextType | undefined>(
  undefined
);
// @ts-expect-error  MS8yOmFIVnBZMlhrdUp2bG43bmx2TG82VGpKWVlnPT06ZDUzYzgyYzI=

export function useChatContext() {
  const context = useContext(ChatContext);
  if (context === undefined) {
    throw new Error("useChatContext must be used within a ChatProvider");
  }
  return context;
}
