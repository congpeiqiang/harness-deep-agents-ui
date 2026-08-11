"use client";
// FIXME  MC80OmFIVnBZMlhrdUp2bG43bmx2TG82VVVSdWNnPT06YjFiOWU4MzE=

import React, {
  useState,
  useRef,
  useCallback,
  useMemo,
  useEffect,
  FormEvent,
  Fragment,
} from "react";
import { Button } from "@/components/ui/button";
import {
  Square,
  ArrowUp,
  CheckCircle,
  Clock,
  Circle,
  FileIcon,
  Plus,
  MessageSquare,
  Settings,
} from "lucide-react";
import { ChatMessage } from "@/app/components/ChatMessage";
import type {
  TodoItem,
  ToolCall,
  ActionRequest,
  ReviewConfig,
} from "@/app/types/types";
import { Assistant, Message } from "@langchain/langgraph-sdk";
import { extractStringFromMessageContent } from "@/app/utils/utils";
import {
  extractInteractiveChartIframes,
  chartToolNames,
} from "@/app/utils/chart";
import { useChatContext } from "@/providers/ChatProvider";
import { cn } from "@/lib/utils";
import { useStickToBottom } from "use-stick-to-bottom";
import { toast } from "sonner";
import { getQueryKeywords } from "@/lib/config";
import { KeywordSettingsDialog } from "@/app/components/KeywordSettingsDialog";
import { FilesPopover } from "@/app/components/TasksFilesSidebar";
import { useFileUpload } from "@/app/hooks/useFileUpload";
import { ContentBlocksPreview } from "@/app/components/ContentBlocksPreview";
// import { DatabaseSelector } from "@/app/components/DatabaseSelector";
import { Label } from "@/components/ui/label";

interface ChatInterfaceProps {
  assistant: Assistant | null;
}
// eslint-disable  MS80OmFIVnBZMlhrdUp2bG43bmx2TG82VVVSdWNnPT06YjFiOWU4MzE=

const getStatusIcon = (status: TodoItem["status"], className?: string) => {
  switch (status) {
    case "completed":
      return (
        <CheckCircle
          size={16}
          className={cn("text-success/80", className)}
        />
      );
    case "in_progress":
      return (
        <Clock
          size={16}
          className={cn("text-warning/80", className)}
        />
      );
    case "query" as any:
      return (
        <MessageSquare
          size={16}
          className={cn("text-blue-500/80", className)}
        />
      );
    default:
      return (
        <Circle
          size={16}
          className={cn("text-tertiary/70", className)}
        />
      );
  }
};
// eslint-disable  Mi80OmFIVnBZMlhrdUp2bG43bmx2TG82VVVSdWNnPT06YjFiOWU4MzE=

// 时间线节点：● 已完成 / ◉ 进行中（转圈）/ ○ 待处理
const timelineNode = (status: TodoItem["status"]) => {
  switch (status) {
    case "completed":
      return (
        <span className="flex h-4 w-4 items-center justify-center text-[11px] leading-none text-success">
          ●
        </span>
      );
    case "in_progress":
      return (
        <span className="flex h-4 w-4 animate-spin items-center justify-center text-[13px] leading-none text-primary">
          ◌
        </span>
      );
    default:
      return (
        <span className="flex h-4 w-4 items-center justify-center text-[11px] leading-none text-tertiary/60">
          ○
        </span>
      );
  }
};

// 时间线单行：节点 + 竖线 + 内容 + 状态标记
const timelineRow = (status: TodoItem["status"], content: string, isLast: boolean) => {
  const statusLabel =
    status === "completed" ? "完成" : status === "in_progress" ? "进行中" : "待处理";
  return (
    <div className="flex">
      {/* 节点列 */}
      <div className="flex w-5 shrink-0 flex-col items-center">
        {timelineNode(status)}
        {!isLast && <span className="mt-0.5 w-px flex-1 bg-border/60" />}
      </div>
      {/* 内容列 */}
      <div className="flex min-w-0 flex-1 items-center gap-2 pb-1.5 pl-2">
        <span
          className={cn(
            "truncate",
            status === "in_progress" && "font-medium text-foreground"
          )}
        >
          {content}
        </span>
        <span
          className={cn(
            "ml-auto shrink-0 text-[10px]",
            status === "completed" && "text-success",
            status === "in_progress" && "text-primary",
            status !== "completed" && status !== "in_progress" && "text-tertiary/50"
          )}
        >
          {statusLabel}
        </span>
      </div>
    </div>
  );
};

// 时间线分组标题
const timelineSectionLabel = (label: string) => (
  <div className="flex items-center gap-2 py-1.5 text-xs font-medium text-muted-foreground">
    <span className="h-px w-3 bg-border/70" />
    <span>{label}</span>
    <span className="h-px flex-1 bg-border/70" />
  </div>
);

// 渲染运行中任务的时间线（查询阶段 → 结果阶段：图表 + 报告）
const renderTimeline = (qt: {
  steps: TodoItem[];
  chartStep?: TodoItem | null;
  reportStep?: TodoItem | null;
}) => {
  // 组装各阶段行（统一为 {status, content}，isLast 由整体长度决定）
  const queryRows = qt.steps.map((s) => ({ status: s.status, content: s.content }));
  const chartRow = qt.chartStep ? { status: qt.chartStep.status, content: qt.chartStep.content } : null;
  const reportRow = qt.reportStep ? { status: qt.reportStep.status, content: qt.reportStep.content } : null;

  const hasQuery = queryRows.length > 0;
  const hasResult = Boolean(chartRow || reportRow);
  if (!hasQuery && !hasResult) return null;

  // 展平所有行，计算 isLast（竖线延伸到非最后一行）
  const allRows: { status: TodoItem["status"]; content: string }[] = [];
  if (hasQuery) allRows.push(...queryRows);
  if (chartRow) allRows.push(chartRow);
  if (reportRow) allRows.push(reportRow);

  let idx = 0;
  const rows: React.ReactNode[] = [];
  if (hasQuery) {
    rows.push(<React.Fragment key="label-query">{timelineSectionLabel("查询阶段")}</React.Fragment>);
    for (let i = 0; i < queryRows.length; i++) {
      rows.push(
        <React.Fragment key={`query-${i}`}>
          {timelineRow(queryRows[i].status, queryRows[i].content, idx === allRows.length - 1)}
        </React.Fragment>
      );
      idx++;
    }
  }
  if (hasResult) {
    rows.push(<React.Fragment key="label-result">{timelineSectionLabel("结果阶段")}</React.Fragment>);
    if (chartRow) {
      rows.push(
        <React.Fragment key="chart">
          {timelineRow(chartRow.status, chartRow.content, idx === allRows.length - 1)}
        </React.Fragment>
      );
      idx++;
    }
    if (reportRow) {
      rows.push(
        <React.Fragment key="report">
          {timelineRow(reportRow.status, reportRow.content, idx === allRows.length - 1)}
        </React.Fragment>
      );
      idx++;
    }
  }

  return <div className="mt-2">{rows}</div>;
};

export const ChatInterface = React.memo<ChatInterfaceProps>(({ assistant }) => {
  const [metaOpen, setMetaOpen] = useState<"tasks" | "files" | null>(null);
  const [keywordSettingsOpen, setKeywordSettingsOpen] = useState(false);
  // 已完成任务汇总行展开控制
  const [historyOpen, setHistoryOpen] = useState(false);
  // 运行中任务折叠控制（默认展开，点击标题折叠成单行）
  const [collapsedRunningIds, setCollapsedRunningIds] = useState<Set<string>>(new Set());
  // const [selectedDb, setSelectedDb] = useState<string>("aix_report");
  const tasksContainerRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const [input, setInput] = useState("");
  const { scrollRef, contentRef } = useStickToBottom();
  const {
    contentBlocks,
    setContentBlocks,
    handleFileUpload,
    dropRef,
    removeBlock,
    resetBlocks,
    dragOver,
    handlePaste,
  } = useFileUpload();

  const {
    stream,
    messages,
    queryTasks,
    runningQueryCount,
    queryInProgress,
    files,
    ui,
    setFiles,
    isLoading,
    isThreadLoading,
    interrupt,
    sendMessage,
    stopStream,
    resumeInterrupt,
    currentContinueTaskKeyRef,
  } = useChatContext();

  // 发送可用性：仅受"智能体未就绪"限制。
  // 不再包含 isLoading —— 续跑 run 期间用户消息优先（sendMessage 会中断续跑）；
  // 用户 run（委派/用户消息）期间由 handleSubmit 提示稍候，但输入/回车始终可用。
  const submitDisabled = !assistant;

  // 数据查询意图判断：命中查询关键词才视为"查询"，查询进行中才拦截；
  // "你好"等闲聊消息不拦截，正常发送。
  // 关键词来自前端配置（localStorage，可配置），与后端 LLM 判断用同一份。
  const isQueryMessage = useCallback((text: string): boolean => {
    const queryKeywords = getQueryKeywords();
    return queryKeywords.some((kw) => text.includes(kw));
  }, []);

  const handleSubmit = useCallback(
    (e?: FormEvent) => {
      if (e) {
        e.preventDefault();
      }
      const messageText = input.trim();
      if ((!messageText && contentBlocks.length === 0) || submitDisabled)
        return;
      // 并发多查询：放开并发，仅做提示/上限保护。
      // 1) 主线程有非续跑 run 在跑（委派 run / 用户上一条消息 run）→ 提示稍候，
      //    等它空闲后再继续。续跑 run 期间（currentContinueTaskKeyRef 非空）则放行：
      //    用户消息优先，由 sendMessage 中断续跑并即时发送。
      // 2) 并发数达到硬上限（HARD_CAP=5）→ 阻止。
      // 3) 已有查询进行中且是查询 → 放行 + 软提示。
      if (isLoading && !currentContinueTaskKeyRef.current) {
        toast("主智能体正在处理，请稍候", {
          description: "主智能体正在执行任务，请等它空闲后再继续。",
          duration: 2500,
        });
        return;
      }
      const isQuery = isQueryMessage(messageText);
      const HARD_CAP = 5;
      if (runningQueryCount >= HARD_CAP && isQuery) {
        toast("并发查询已达上限", {
          description: `当前已有 ${runningQueryCount} 个查询进行中，请等待部分完成后再发起。`,
          duration: 3000,
        });
        return;
      }
      if (queryInProgress && isQuery) {
        toast("已加入并发查询", {
          description: `已同时处理 ${runningQueryCount + 1} 个查询；超出并发上限的任务完成后将自动排队继续。`,
          duration: 2500,
        });
      }
      // const configurable = { db_name: selectedDb };
      // console.log("[DB_SELECT] db_name:", selectedDb);
      sendMessage(messageText, contentBlocks);
      setInput("");
      resetBlocks();
    },
    [
      input, contentBlocks, isLoading, sendMessage, submitDisabled,
      runningQueryCount, queryInProgress, isQueryMessage,
      currentContinueTaskKeyRef,
    ]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (submitDisabled) return;
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit, submitDisabled]
  );

  // TODO: can we make this part of the hook?
  const messageUiMap = useMemo(() => {
    const nextMap = new Map<string, any[]>();

    if (!ui) {
      return nextMap;
    }

    ui.forEach((item: any) => {
      const messageId = item.metadata?.message_id;
      if (!messageId) {
        return;
      }

      const existing = nextMap.get(messageId);
      if (existing) {
        existing.push(item);
      } else {
        nextMap.set(messageId, [item]);
      }
    });

    return nextMap;
  }, [ui]);

  const processedMessages = useMemo(() => {
    const messageMap = new Map<
      string,
      { message: Message; toolCalls: ToolCall[] }
    >();

    messages.forEach((message: Message) => {
      if (message.type === "ai") {
        const toolCallsInMessage: Array<{
          id?: string;
          function?: { name?: string; arguments?: unknown };
          name?: string;
          type?: string;
          args?: unknown;
          input?: unknown;
        }> = [];

        if (
          message.additional_kwargs?.tool_calls &&
          Array.isArray(message.additional_kwargs.tool_calls)
        ) {
          toolCallsInMessage.push(...message.additional_kwargs.tool_calls);
        } else if (message.tool_calls && Array.isArray(message.tool_calls)) {
          toolCallsInMessage.push(
            ...message.tool_calls.filter(
              (toolCall: { name?: string }) => toolCall.name !== ""
            )
          );
        } else if (Array.isArray(message.content)) {
          const toolUseBlocks = message.content.filter(
            (block: { type?: string }) => block.type === "tool_use"
          );
          toolCallsInMessage.push(...toolUseBlocks);
        }

        const toolCallsWithStatus = toolCallsInMessage.map(
          (toolCall: {
            id?: string;
            function?: { name?: string; arguments?: unknown };
            name?: string;
            type?: string;
            args?: unknown;
            input?: unknown;
          }) => {
            const name =
              toolCall.function?.name ||
              toolCall.name ||
              toolCall.type ||
              "unknown";
            const args =
              toolCall.function?.arguments ||
              toolCall.args ||
              toolCall.input ||
              {};
            return {
              id: toolCall.id || `tool-${Math.random()}`,
              name,
              args,
              status: interrupt ? "interrupted" : ("pending" as const),
            } as ToolCall;
          }
        );

        messageMap.set(message.id!, {
          message,
          toolCalls: toolCallsWithStatus,
        });
      } else if (message.type === "tool") {
        if ((message as any).name === "delegate") {
          console.log("[ChatInterface-delegate] ToolMessage keys:", Object.keys(message));
          console.log("[ChatInterface-delegate] artifact:", (message as any).artifact);
          console.log("[ChatInterface-delegate] content type:", typeof message.content);
          console.log("[ChatInterface-delegate] message:", JSON.parse(JSON.stringify(message)));
        }
        const toolCallId = message.tool_call_id;
        if (!toolCallId) {
          return;
        }

        for (const [, data] of messageMap.entries()) {
          const toolCallIndex = data.toolCalls.findIndex(
            (tc: ToolCall) => tc.id === toolCallId
          );
          if (toolCallIndex === -1) {
            continue;
          }

          data.toolCalls[toolCallIndex] = {
            ...data.toolCalls[toolCallIndex],
            status: "completed" as const,
            result: extractStringFromMessageContent(message),
            artifact: (message as any).artifact,
          };
          break;
        }
      } else if (message.type === "human") {
        messageMap.set(message.id!, {
          message,
          toolCalls: [],
        });
      }
    });

    const processedArray = Array.from(messageMap.values());
    const withShowAvatar = processedArray.map((data, index) => {
      const prevMessage = index > 0 ? processedArray[index - 1].message : null;
      return {
        ...data,
        showAvatar: data.message.type !== prevMessage?.type,
      };
    });

    // ── 附随图表：最新生成的 echarts 交互 iframe 附到下一个「有正文且无工具调用」的
    // AI 消息（报告呈现消息）上方。生成步骤消息（含图表工具调用）本身已在正文/工具卡
    // 渲染图表；报告消息只有文字，把同轮最新图表附随过去，让报告也呈现交互图表。 ──
    let pendingChart: string | null = null;
    for (const d of withShowAvatar) {
      const msgText = extractStringFromMessageContent(d.message) || "";
      const html = extractInteractiveChartIframes(msgText).join("");
      if (html) {
        pendingChart = html;
      } else {
        const fromTools = (d.toolCalls || [])
          .filter(
            (tc: ToolCall) =>
              chartToolNames.some((n) => (tc.name || "").includes(n)) &&
              typeof tc.result === "string"
          )
          .map((tc: ToolCall) =>
            extractInteractiveChartIframes(tc.result as string).join("")
          )
          .join("");
        if (fromTools) pendingChart = fromTools;
      }
      if (
        pendingChart &&
        d.message.type === "ai" &&
        !(d.toolCalls && d.toolCalls.length > 0) &&
        msgText.trim()
      ) {
        (d as any).chartAttachmentHtml = pendingChart;
        pendingChart = null;
      }
    }

    return withShowAvatar as Array<{
      message: Message;
      toolCalls: ToolCall[];
      showAvatar: boolean;
      chartAttachmentHtml?: string;
    }>;
  }, [messages, interrupt]);

  // 主智能体自身的顺序步骤（查询进度由 queryTasks 独立展示，不再注入）
  const hasFiles = Object.keys(files).length > 0;

  // Parse out any action requests or review configs from the interrupt
  const actionRequestsMap: Map<string, ActionRequest> | null = useMemo(() => {
    const actionRequests =
      interrupt?.value && (interrupt.value as any)["action_requests"];
    if (!actionRequests) return new Map<string, ActionRequest>();
    return new Map(actionRequests.map((ar: ActionRequest) => [ar.name, ar]));
  }, [interrupt]);

  const reviewConfigsMap: Map<string, ReviewConfig> | null = useMemo(() => {
    const reviewConfigs =
      interrupt?.value && (interrupt.value as any)["review_configs"];
    if (!reviewConfigs) return new Map<string, ReviewConfig>();
    return new Map(
      reviewConfigs.map((rc: ReviewConfig) => [rc.actionName, rc])
    );
  }, [interrupt]);

  const lastMessageId = processedMessages.at(-1)?.message.id;

  useEffect(() => {
    const scrollElement = scrollRef.current;
    if (!scrollElement) return;

    const frameId = window.requestAnimationFrame(() => {
      scrollElement.scrollTo({
        top: scrollElement.scrollHeight,
        behavior: isLoading ? "auto" : "smooth",
      });
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [lastMessageId, processedMessages.length, isLoading, scrollRef]);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div
        className="flex-1 overflow-y-auto overflow-x-hidden overscroll-contain"
        ref={scrollRef}
      >
        <div
          className="mx-auto w-full max-w-[1024px] px-6 pb-6 pt-4"
          ref={contentRef}
        >
          {isThreadLoading ? (
            <div className="flex items-center justify-center p-8">
              <p className="text-muted-foreground">加载中...</p>
            </div>
          ) : (
            <>
              {processedMessages
              .filter((data) => {
                // 隐藏前端自动发送的子智能体继续消息
                const content =
                  typeof data.message.content === "string"
                    ? data.message.content
                    : "";
                return !content.startsWith("子智能体查询已完成，请继续执行后续步骤");
              })
              .map((data, index, filteredArr) => {
                const messageUi = messageUiMap.get(data.message.id ?? "");
                const isLastMessage = index === filteredArr.length - 1;
                return (
                  <ChatMessage
                    key={data.message.id}
                    message={data.message}
                    toolCalls={data.toolCalls}
                    isLoading={isLoading}
                    isStreaming={isLastMessage && isLoading}
                    actionRequestsMap={
                      isLastMessage ? actionRequestsMap : undefined
                    }
                    reviewConfigsMap={
                      isLastMessage ? reviewConfigsMap : undefined
                    }
                    ui={messageUi}
                    stream={isLastMessage ? stream : undefined}
                    onResumeInterrupt={
                      isLastMessage ? resumeInterrupt : undefined
                    }
                    graphId={isLastMessage ? assistant?.graph_id : undefined}
                    chartAttachmentHtml={data.chartAttachmentHtml}
                  />
                );
              })}
            </>
          )}
        </div>
      </div>

      <div className="flex-shrink-0 bg-background">
        <div
          ref={dropRef}
          className={cn(
            "mx-4 mb-6 flex flex-shrink-0 flex-col overflow-hidden rounded-xl border border-border bg-background",
            "mx-auto w-[calc(100%-32px)] max-w-[1024px] transition-colors duration-200 ease-in-out",
            dragOver && "border-primary border-2 border-dotted"
          )}
        >
          {(hasFiles || queryTasks.length > 0) && (
            <div className="flex max-h-72 flex-col overflow-y-auto border-b border-border bg-sidebar empty:hidden">
              {!metaOpen && (
                <>
                  {/* 并发多查询进度（4 层分组：running 完整 / 最近完成单行 / 历史汇总） */}
                  {queryTasks.length > 0 && (() => {
                    // 分组：running 任务 + 已完成任务（汇总一行，点击展开）
                    const runningTasks = queryTasks.filter((t) => t.status === "running");
                    const doneTasks = queryTasks.filter((t) => t.status !== "running");

                    // 计算任务进度比例（查询 + 图表 + 报告 三段一起算）
                    const progressOf = (qt: any) => {
                      const all = [
                        ...(qt.steps || []),
                        ...(qt.chartStep ? [qt.chartStep] : []),
                        ...(qt.reportStep ? [qt.reportStep] : []),
                      ];
                      if (all.length === 0) return 0;
                      const done = all.filter((s: any) => s.status === "completed").length;
                      return Math.round((done / all.length) * 100);
                    };

                    return (
                      <div className="flex flex-col divide-y divide-border">
                        {/* 1. running 任务：完整卡片 */}
                        {runningTasks.map((qt) => {
                          const pct = progressOf(qt);
                          const collapsed = collapsedRunningIds.has(qt.task_id);
                          const allSteps = [
                            ...(qt.steps || []),
                            ...(qt.chartStep ? [qt.chartStep] : []),
                            ...(qt.reportStep ? [qt.reportStep] : []),
                          ];
                          const doneCount = allSteps.filter((s: any) => s.status === "completed").length;
                          return (
                            <div key={qt.task_id} className="px-[18px] py-2.5">
                              <button
                                type="button"
                                className="flex w-full cursor-pointer items-center gap-2 text-sm"
                                onClick={() => {
                                  setCollapsedRunningIds((prev) => {
                                    const next = new Set(prev);
                                    if (next.has(qt.task_id)) next.delete(qt.task_id);
                                    else next.add(qt.task_id);
                                    return next;
                                  });
                                }}
                              >
                                <Clock size={14} className="text-primary shrink-0" />
                                <span className="truncate font-medium text-foreground">{qt.title}</span>
                                <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                                  进行中 {allSteps.length > 0 ? `${doneCount}/${allSteps.length}` : ""} {collapsed ? "▸" : "▾"}
                                </span>
                              </button>
                              {/* 折叠时仅显示进度条（紧凑），展开时显示时间线（查询/图表/报告阶段） */}
                              {!collapsed && (
                                <>
                                  {qt.steps.length > 0 && (
                                    <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-muted/50">
                                      <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
                                    </div>
                                  )}
                                  {renderTimeline(qt)}
                                </>
                              )}
                            </div>
                          );
                        })}

                        {/* 2. 已完成任务：汇总一行，点击展开全部列表（计数与内容一致） */}
                        {doneTasks.length > 0 && (
                          <div className="px-[18px] py-2">
                            <button
                              type="button"
                              className="flex w-full cursor-pointer items-center gap-2 text-sm"
                              onClick={() => setHistoryOpen((v) => !v)}
                            >
                              <CheckCircle size={14} className="text-success/80 shrink-0" />
                              <span className="font-medium text-foreground">✅ 已完成 {doneTasks.length} 个查询</span>
                              <span className="ml-auto shrink-0 text-xs text-muted-foreground">{historyOpen ? "▾" : "▸"}</span>
                            </button>
                            {historyOpen && (
                              <div className="mt-1.5 flex flex-col">
                                {doneTasks.map((qt) => (
                                  <div key={qt.task_id} className="flex items-center gap-2 py-1 text-xs text-muted-foreground">
                                    <span className="w-3 shrink-0 text-center">✓</span>
                                    <span className="truncate">{qt.title}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })()}
                  {(() => {
                    const filesTrigger = (() => {
                      if (!hasFiles) return null;
                      return (
                        <button
                          type="button"
                          onClick={() =>
                            setMetaOpen((prev) =>
                              prev === "files" ? null : "files"
                            )
                          }
                          className="flex flex-shrink-0 cursor-pointer items-center gap-2 px-[18px] py-3 text-left text-sm"
                          aria-expanded={metaOpen === "files"}
                        >
                          <FileIcon size={16} />
                          文件 (状态)
                          <span className="h-4 min-w-4 rounded-full bg-[#2F6868] px-0.5 text-center text-[10px] leading-[16px] text-white">
                            {Object.keys(files).length}
                          </span>
                        </button>
                      );
                    })();

                    return (
                      <div className="flex items-center justify-between">
                        {/* 主 todos 的"任务 X/Y"触发器已移除——每个查询的委派/图表/报告
                            进度由上方并发查询卡片展示，避免与旧 write_todos 混乱列表重复。 */}
                        {filesTrigger}
                      </div>
                    );
                  })()}
                </>
              )}

              {metaOpen && (
                <>
                  <div className="sticky top-0 flex items-stretch bg-sidebar text-sm">
                    {hasFiles && (
                      <button
                        type="button"
                        className="inline-flex items-center gap-2 py-3 pr-4 first:pl-[18px] aria-expanded:font-semibold"
                        onClick={() =>
                          setMetaOpen((prev) =>
                            prev === "files" ? null : "files"
                          )
                        }
                        aria-expanded={metaOpen === "files"}
                      >
                        文件 (状态)
                        <span className="h-4 min-w-4 rounded-full bg-[#2F6868] px-0.5 text-center text-[10px] leading-[16px] text-white">
                          {Object.keys(files).length}
                        </span>
                      </button>
                    )}
                    <button
                      aria-label="Close"
                      className="flex-1"
                      onClick={() => setMetaOpen(null)}
                    />
                  </div>
                  <div
                    ref={tasksContainerRef}
                    className="px-[18px]"
                  >
                    {metaOpen === "tasks" &&
                      // 主 todos 面板已隐藏——每个查询的委派/图表/报告进度
                      // 由顶部并发查询卡片（queryTasks）完整展示，避免与旧 write_todos
                      // 整体替换导致的混乱列表重复显示。
                      (queryTasks.length === 0 ? (
                        <div className="py-3 text-sm text-muted-foreground">暂无任务</div>
                      ) : (
                        <div className="py-3 text-sm text-muted-foreground">
                          查询进度见上方卡片（每个查询含委派、子步骤、图表、报告）
                        </div>
                      ))}

                    {metaOpen === "files" && (
                      <div className="mb-6">
                        <FilesPopover
                          files={files}
                          setFiles={setFiles}
                          editDisabled={
                            isLoading === true || interrupt !== undefined
                          }
                        />
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
          <form
            onSubmit={handleSubmit}
            className="flex flex-col"
          >
            <ContentBlocksPreview
              blocks={contentBlocks}
              onRemove={removeBlock}
            />
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              placeholder={isLoading ? "运行中..." : "输入您的消息..."}
              className="font-inherit field-sizing-content flex-1 resize-none border-0 bg-transparent px-[18px] pb-[13px] pt-[14px] text-sm leading-7 text-primary outline-none placeholder:text-tertiary"
              rows={1}
            />
            <div className="flex justify-between gap-2 p-3">
              <div className="flex items-center gap-2">
                <Label
                  htmlFor="file-input"
                  className="flex cursor-pointer items-center gap-2 text-muted-foreground hover:text-primary"
                >
                  <Plus className="size-5" />
                  <span className="text-sm">上传 PDF 或图片</span>
                {/* <DatabaseSelector value={selectedDb} onChange={setSelectedDb} /> */}
                </Label>
                <input
                  id="file-input"
                  type="file"
                  onChange={handleFileUpload}
                  multiple
                  accept="image/jpeg,image/png,image/gif,image/webp,application/pdf"
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => setKeywordSettingsOpen(true)}
                  className="flex cursor-pointer items-center gap-1 rounded-md p-1.5 text-muted-foreground transition-colors hover:text-primary"
                  title="查询关键词设置"
                  aria-label="查询关键词设置"
                >
                  <Settings className="size-4" />
                </button>
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  type={isLoading ? "button" : "submit"}
                  variant={isLoading ? "destructive" : "default"}
                  onClick={isLoading ? stopStream : handleSubmit}
                  disabled={
                    !isLoading &&
                    (submitDisabled ||
                      (!input.trim() && contentBlocks.length === 0))
                  }
                >
                  {isLoading ? (
                    <>
                      <Square size={14} />
                      <span>停止</span>
                    </>
                  ) : (
                    <>
                      <ArrowUp size={18} />
                      <span>发送</span>
                    </>
                  )}
                </Button>
              </div>
            </div>
          </form>
        </div>
      </div>
      <KeywordSettingsDialog
        open={keywordSettingsOpen}
        onOpenChange={setKeywordSettingsOpen}
      />
    </div>
  );
});

ChatInterface.displayName = "ChatInterface";
// FIXME  My80OmFIVnBZMlhrdUp2bG43bmx2TG82VVVSdWNnPT06YjFiOWU4MzE=
