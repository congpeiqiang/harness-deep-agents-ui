"use client";

import React, { useMemo, useState, useCallback } from "react";
import { SubAgentIndicator } from "@/app/components/SubAgentIndicator";
import { ToolCallBox } from "@/app/components/ToolCallBox";
import { MarkdownContent } from "@/app/components/MarkdownContent";
import { MultimodalPreview } from "@/app/components/MultimodalPreview";
import { ReportFileActions } from "@/app/components/ReportFileActions";
import { ThinkingBlock } from "@/app/components/ThinkingBlock";
import { MessageFeedbackActions, type RoundStat } from "@/app/components/MessageFeedbackActions";
import type { FeedbackRecord } from "@/lib/feedback";
import { Button } from "@/components/ui/button";
import { GitFork } from "lucide-react";
import type {
  SubAgent,
  ToolCall,
  ActionRequest,
  ReviewConfig,
} from "@/app/types/types";
import { Message } from "@langchain/langgraph-sdk";
import { ContentBlock } from "@langchain/core/messages";
import {
  extractSubAgentContent,
  extractStringFromMessageContent,
} from "@/app/utils/utils";
import {
  extractInteractiveChartIframes,
  chartToolNames,
} from "@/app/utils/chart";
import { cn } from "@/lib/utils";
// NOTE  MC80OmFIVnBZMlhrdUp2bG43bmx2TG82TVRWSlVRPT06NGI5M2JjYjQ=

/**
 * 从文本中剥离图表 iframe 标签（完整 + 流式 partial），
 * 避免消息正文中残留 iframe HTML 显示为乱码文本。
 * 图表统一由 chartIframes 在工具卡片下方渲染，同一图表只显示一次。
 */
function stripIframeFromText(text: string): string {
  if (!text) return text;
  // 1) 剥离完整的 iframe 标签
  let result = text.replace(/<iframe[^>]*>[\s\S]*?<\/iframe>/gi, '');
  // 2) 剥离流式输出末尾不完整的 iframe 标签（<iframe ... 但尚无 </iframe>）
  //    含 data:text/html;base64 的大段 HTML 属于图表 iframe，截断隐藏；
  //    不含 base64 的短 <iframe 片段（如用户讨论文字）保留不动。
  const partialMatch = result.match(/<iframe(?:(?!<\/iframe>)[\s\S])*$/i);
  if (partialMatch && /data:text\/html/i.test(partialMatch[0])) {
    result = result.slice(0, result.lastIndexOf('<iframe'));
  }
  return result.trim();
}

/** image_url block as sent to OpenAI-compatible APIs (e.g. Doubao) */
interface ImageUrlBlock {
  type: "image_url";
  image_url: { url: string };
}

/** Returns true for image_url blocks stored in message.content */
function isImageUrlBlock(block: unknown): block is ImageUrlBlock {
  if (typeof block !== "object" || block === null || !("type" in block))
    return false;
  const b = block as { type: unknown; image_url?: unknown };
  return (
    b.type === "image_url" &&
    typeof b.image_url === "object" &&
    b.image_url !== null &&
    "url" in (b.image_url as object) &&
    typeof (b.image_url as { url: unknown }).url === "string"
  );
}

/** Returns true for PDF blocks in additional_kwargs.attachments */
function isMultimodalBlock(
  block: unknown
): block is ContentBlock.Multimodal.Data {
  if (typeof block !== "object" || block === null || !("type" in block))
    return false;
  const b = block as { type: unknown; mimeType?: unknown };
  return (
    b.type === "file" &&
    typeof b.mimeType === "string" &&
    b.mimeType === "application/pdf"
  );
}
// FIXME  MS80OmFIVnBZMlhrdUp2bG43bmx2TG82TVRWSlVRPT06NGI5M2JjYjQ=

interface ChatMessageProps {
  message: Message;
  toolCalls: ToolCall[];
  isLoading?: boolean;
  isStreaming?: boolean;
  actionRequestsMap?: Map<string, ActionRequest>;
  reviewConfigsMap?: Map<string, ReviewConfig>;
  ui?: any[];
  stream?: any;
  onResumeInterrupt?: (value: any) => void;
  graphId?: string;
  /** P1-1 消息反馈：当前会话 ID（反馈 API 需要） */
  threadId?: string;
  /** P1-1 消息反馈：该消息已有的反馈（回显图标态） */
  feedback?: FeedbackRecord | null;
  /** P1-1 消息反馈：当前选中库名（首次保存快照进 context） */
  dbContext?: string;
  /** P1-1 消息反馈：父级更新 feedbackMap 的回调 */
  onFeedbackChange?: (messageId: string, feedback: FeedbackRecord | null) => void;
  /** P1-5 会话分叉：从此消息分叉（复制截止到该消息的新会话并跳转） */
  onFork?: (messageId: string) => void;
  /** P1-5 会话分叉：正在分叉中（禁用按钮） */
  forkBusy?: boolean;
  /** Token 计量：该消息的首 token 耗时（TTFT, ms） */
  ttftMs?: number;
  /** Token 计量：该消息的总耗时（ms） */
  durationMs?: number;
  /** Token 计量：该轮 token 维度（后端 steps 按轮聚合） */
  roundStat?: RoundStat;
}

function areToolCallsEqual(prevToolCalls: ToolCall[], nextToolCalls: ToolCall[]) {
  if (prevToolCalls === nextToolCalls) return true;
  if (prevToolCalls.length !== nextToolCalls.length) return false;

  return prevToolCalls.every((toolCall, index) => {
    const nextToolCall = nextToolCalls[index];
    return (
      toolCall.id === nextToolCall.id &&
      toolCall.name === nextToolCall.name &&
      toolCall.status === nextToolCall.status &&
      toolCall.result === nextToolCall.result &&
      toolCall.args === nextToolCall.args
    );
  });
}
// eslint-disable  Mi80OmFIVnBZMlhrdUp2bG43bmx2TG82TVRWSlVRPT06NGI5M2JjYjQ=

function areUiEntriesEqual(prevUi?: any[], nextUi?: any[]) {
  if (prevUi === nextUi) return true;
  if (!prevUi || !nextUi) return prevUi === nextUi;
  if (prevUi.length !== nextUi.length) return false;

  return prevUi.every((entry, index) => entry === nextUi[index]);
}

export const ChatMessage = React.memo<ChatMessageProps>(
  ({
    message,
    toolCalls,
    isLoading,
    isStreaming,
    actionRequestsMap,
    reviewConfigsMap,
    ui,
    stream,
    onResumeInterrupt,
    graphId,
    threadId,
    feedback,
    dbContext,
    onFeedbackChange,
    onFork,
    forkBusy,
    ttftMs,
    durationMs,
    roundStat,
  }) => {
    const isUser = message.type === "human";
    const isAi = message.type === "ai";
    const messageContent = extractStringFromMessageContent(message);
    const hasContent = messageContent && messageContent.trim() !== "";
    const hasToolCalls = toolCalls.length > 0;
    const isStreamingMessage = isAi && isStreaming === true;

    // 图表 iframe 提取：优先从图表工具结果取（完整且可靠），仅无工具图表时回退消息正文。
    // 流式输出时正文 iframe 可能不完整（base64 未结束），工具结果则始终完整。
    const chartIframes = useMemo(() => {
      if (!isAi) return [];
      // 1) 优先：图表工具调用结果（完整 HTML，始终可用）
      const toolIframes: string[] = [];
      toolCalls.forEach((tc) => {
        if (!tc.result || typeof tc.result !== "string") return;
        const isChartTool = chartToolNames.some(
          (n) => tc.name === n || (tc.name || "").includes(n)
        );
        if (!isChartTool) return;
        toolIframes.push(...extractInteractiveChartIframes(tc.result));
      });
      if (toolIframes.length > 0) {
        return toolIframes.filter((html, i) => toolIframes.indexOf(html) === i);
      }
      // 2) 回退：消息正文中的 iframe（无图表工具调用时）
      return extractInteractiveChartIframes(messageContent);
    }, [isAi, messageContent, toolCalls]);

    const subAgents = useMemo(
      () =>
        toolCalls
          .filter(
            (tc: ToolCall) =>
              tc.name === "task" &&
              tc.args["subagent_type"] &&
              tc.args["subagent_type"] !== "" &&
              tc.args["subagent_type"] !== null
          )
          .map((tc: ToolCall) => ({
            id: tc.id,
            name: tc.name,
            subAgentName: (tc.args as Record<string, unknown>)["subagent_type"] as string,
            input: tc.args,
            output: tc.result ? { result: tc.result } : undefined,
            status: tc.status,
          } as SubAgent)),
      [toolCalls]
    );

    const [expandedSubAgents, setExpandedSubAgents] = useState<Record<string, boolean>>({});
    const isSubAgentExpanded = useCallback(
      (id: string) => expandedSubAgents[id] ?? true,
      [expandedSubAgents]
    );
    const toggleSubAgent = useCallback((id: string) => {
      setExpandedSubAgents((prev) => ({
        ...prev,
        [id]: prev[id] === undefined ? false : !prev[id],
      }));
    }, []);

    // Images: image_url blocks in message.content (sent directly to LLM)
    const imageUrlBlocks = Array.isArray(message.content)
      ? (message.content as unknown[]).filter(isImageUrlBlock)
      : [];

    // PDFs: in additional_kwargs.attachments (backend parses them)
    const rawAttachments = (message.additional_kwargs as Record<string, unknown>)?.attachments;
    const pdfBlocks = Array.isArray(rawAttachments)
      ? (rawAttachments as unknown[]).reduce<ContentBlock.Multimodal.Data[]>(
          (acc, b) => { if (isMultimodalBlock(b)) acc.push(b); return acc; },
          []
        )
      : [];

    const hasAttachments = imageUrlBlocks.length > 0 || pdfBlocks.length > 0;

    return (
      <div
        className={cn("flex w-full max-w-full overflow-x-hidden", isUser && "flex-row-reverse")}
        style={{ contentVisibility: "auto", containIntrinsicSize: "200px" }}
      >
        <div className={cn("min-w-0 max-w-full", isUser ? "max-w-[70%]" : "w-full")}>
          {isUser ? (
            /* ── Human message: images + PDFs + text ── */
            <div className="group mt-4 flex flex-col items-end gap-2">
              {hasAttachments && (
                <div className="flex flex-wrap justify-end gap-2">
                  {/* Images: rendered from data URL directly */}
                  {imageUrlBlocks.map((block, idx) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      key={`img-${idx}`}
                      src={block.image_url.url}
                      alt={`uploaded image ${idx + 1}`}
                      className="h-16 w-16 rounded-md object-cover"
                    />
                  ))}
                  {/* PDFs: rendered via MultimodalPreview */}
                  {pdfBlocks.map((block, idx) => (
                    <MultimodalPreview key={`pdf-${idx}`} block={block} size="md" />
                  ))}
                </div>
              )}
              {hasContent && (
                <div
                  className="overflow-hidden break-words rounded-xl rounded-br-none border border-border px-3 py-2 text-sm font-normal leading-[150%] text-foreground"
                  style={{ backgroundColor: "var(--color-user-message-bg)" }}
                >
                  <p className="m-0 whitespace-pre-wrap break-words text-sm leading-relaxed">
                    {messageContent}
                  </p>
                </div>
              )}
              {/* P1-5 从此处分叉：用户消息悬停显示（改写问题/改口径重新验证入口） */}
              {!isStreamingMessage && message.id && threadId && onFork && (
                <div className="flex justify-end opacity-0 transition-opacity group-hover:opacity-60 hover:opacity-100">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground"
                    onClick={() => onFork(message.id!)}
                    disabled={forkBusy || isLoading}
                    aria-label="从此处分叉"
                    title="从此处分叉：复制截止到这条消息的新会话，可改写问题重新验证"
                  >
                    <GitFork size={14} />
                  </Button>
                </div>
              )}
            </div>
          ) : (
            /* ── AI message ── */
            (() => {
                // 从消息正文中剥离 iframe（完整 + 流式 partial），
                // 图表由 chartIframes 在工具卡片下方统一渲染，同一图表只显示一次。
                const textContent = stripIframeFromText(messageContent);
                // 思考阶段（reasoning_content）：有则显示（后端开了思考才流过来，关了自然没有）
                const reasoning = (message.additional_kwargs as Record<string, unknown>)?.reasoning_content;
                return (
                  <>
                    {typeof reasoning === "string" &&
                      reasoning.trim() !== "" && (
                        <ThinkingBlock
                          content={reasoning}
                          streaming={isStreamingMessage}
                        />
                      )}
                    {textContent && (
                      <div className={cn("relative flex items-end gap-0")}>
                        <div className="mt-4 overflow-hidden break-words text-sm font-normal leading-[150%] text-primary">
                          <MarkdownContent
                            content={textContent}
                            streaming={isStreamingMessage}
                          />
                        </div>
                      </div>
                    )}
                    {/* 报告文件预览/下载：识别消息里的 /workspace/report/*.md 路径 */}
                    {textContent && <ReportFileActions content={textContent} />}
                    {/* P1-1 消息反馈：非流式、有正文、有 message.id 的 AI 消息才显示 */}
                    {hasContent &&
                      !isStreamingMessage &&
                      message.id &&
                      threadId &&
                      onFeedbackChange && (
                        <MessageFeedbackActions
                          threadId={threadId}
                          messageId={message.id}
                          feedback={feedback}
                          dbContext={dbContext}
                          disabled={isLoading}
                          onChange={onFeedbackChange}
                          copyText={textContent}
                          ttftMs={ttftMs}
                          durationMs={durationMs}
                          roundStat={roundStat}
                          extraActions={
                            onFork && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-muted-foreground"
                                onClick={() => onFork(message.id!)}
                                disabled={forkBusy || isLoading}
                                aria-label="从此处分叉"
                                title="从此处分叉：复制截止到这条消息的新会话"
                              >
                                <GitFork size={14} />
                              </Button>
                            )
                          }
                        />
                      )}
                  </>
                );
              })()
          )}
          {hasToolCalls && (
            <div className="mt-4 flex w-full flex-col">
              {toolCalls.map((toolCall: ToolCall) => {
                // Show task subagent calls
                const toolCallGenUiComponent =
                  ui && ui.length > 0
                    ? ui.find((u) => u.metadata?.tool_call_id === toolCall.id)
                    : undefined;
                const actionRequest = actionRequestsMap?.get(toolCall.name);
                const reviewConfig = reviewConfigsMap?.get(toolCall.name);
                return (
                  <ToolCallBox
                    key={toolCall.id}
                    toolCall={toolCall}
                    uiComponent={toolCallGenUiComponent}
                    stream={stream}
                    graphId={graphId}
                    actionRequest={actionRequest}
                    reviewConfig={reviewConfig}
                    onResume={onResumeInterrupt}
                    isLoading={isLoading}
                  />
                );
              })}
            </div>
          )}
          {/* 图表：渲染在工具卡片下方 */}
          {chartIframes.length > 0 && (
            <div className="mt-4 flex w-full flex-col gap-4">
              {chartIframes.map((html, i) => (
                <div key={i} className="w-full" dangerouslySetInnerHTML={{ __html: html }} />
              ))}
            </div>
          )}
          {!isUser && subAgents.length > 0 && (
            <div className="flex w-fit max-w-full flex-col gap-4">
              {subAgents.map((subAgent) => (
                <div key={subAgent.id} className="flex w-full flex-col gap-2">
                  <div className="flex items-end gap-2">
                    <div className="w-[calc(100%-100px)]">
                      <SubAgentIndicator
                        subAgent={subAgent}
                        onClick={() => toggleSubAgent(subAgent.id)}
                        isExpanded={isSubAgentExpanded(subAgent.id)}
                      />
                    </div>
                  </div>
                  {isSubAgentExpanded(subAgent.id) && (
                    <div className="w-full max-w-full">
                      <div className="bg-surface border-border-light rounded-md border p-4">
                        <h4 className="text-primary/70 mb-2 text-xs font-semibold uppercase tracking-wider">
                          输入
                        </h4>
                        <div className="mb-4">
                          <MarkdownContent content={extractSubAgentContent(subAgent.input)} />
                        </div>
                        {subAgent.output && (
                          <>
                            <h4 className="text-primary/70 mb-2 text-xs font-semibold uppercase tracking-wider">
                              输出
                            </h4>
                            <MarkdownContent content={extractSubAgentContent(subAgent.output)} />
                          </>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  },
  (prevProps, nextProps) => {
    const isSameMessage = prevProps.message === nextProps.message;
    const isSameToolCalls = areToolCallsEqual(
      prevProps.toolCalls,
      nextProps.toolCalls
    );
    const isSameUi = areUiEntriesEqual(prevProps.ui, nextProps.ui);
    const isSameInterruptMaps =
      prevProps.actionRequestsMap === nextProps.actionRequestsMap &&
      prevProps.reviewConfigsMap === nextProps.reviewConfigsMap;

    const isSameLastMessageState =
      prevProps.stream === nextProps.stream &&
      prevProps.onResumeInterrupt === nextProps.onResumeInterrupt &&
      prevProps.graphId === nextProps.graphId &&
      prevProps.isLoading === nextProps.isLoading &&
      prevProps.isStreaming === nextProps.isStreaming;

    const isSameFeedback =
      prevProps.threadId === nextProps.threadId &&
      prevProps.feedback === nextProps.feedback &&
      prevProps.dbContext === nextProps.dbContext &&
      prevProps.onFeedbackChange === nextProps.onFeedbackChange;

    const isSameFork =
      prevProps.onFork === nextProps.onFork &&
      prevProps.forkBusy === nextProps.forkBusy;

    const isSameTiming =
      prevProps.ttftMs === nextProps.ttftMs &&
      prevProps.durationMs === nextProps.durationMs &&
      prevProps.roundStat === nextProps.roundStat;

    return (
      isSameMessage &&
      isSameToolCalls &&
      isSameUi &&
      isSameInterruptMaps &&
      isSameLastMessageState &&
      isSameFeedback &&
      isSameFork &&
      isSameTiming
    );
  }
);
// NOTE  My80OmFIVnBZMlhrdUp2bG43bmx2TG82TVRWSlVRPT06NGI5M2JjYjQ=

ChatMessage.displayName = "ChatMessage";

