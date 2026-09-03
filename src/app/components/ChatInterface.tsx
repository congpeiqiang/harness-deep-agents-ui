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
  AlertCircle,
  FileIcon,
  Plus,
  Loader2,
} from "lucide-react";
import { ChatMessage } from "@/app/components/ChatMessage";
import type {
  TodoItem,
  ToolCall,
  ActionRequest,
  ReviewConfig,
} from "@/app/types/types";
import { Assistant, Message } from "@langchain/langgraph-sdk";
import {
  extractStringFromMessageContent,
} from "@/app/utils/utils";
import { extractInteractiveChartIframes, chartToolNames } from "@/app/utils/chart";
import { useChatContext } from "@/providers/ChatProvider";
import { cn } from "@/lib/utils";
import { useQueryState } from "nuqs";
import { useStickToBottom } from "use-stick-to-bottom";
import { toast } from "sonner";
import { getQueryKeywords, getEnableThinking } from "@/lib/config";
import { getActiveWorkspace } from "@/lib/workspace";
import { listThreadFeedback, type FeedbackRecord } from "@/lib/feedback";
import { forkThread } from "@/lib/threadFork";
import { decideSqlApproval, type SqlApprovalDecision } from "@/lib/sqlApproval";
import { cancelTask } from "@/lib/cancelTask";
import { SqlApprovalCard, type SqlApprovalPayload } from "@/app/components/SqlApprovalCard";
import { generateAutoTitle, setThreadTitle } from "@/lib/threadMeta";
import { useClient } from "@/providers/ClientProvider";
import { FilesPopover } from "@/app/components/TasksFilesSidebar";
import { useFileUpload } from "@/app/hooks/useFileUpload";
import { ContentBlocksPreview } from "@/app/components/ContentBlocksPreview";
import { DatabaseSelector } from "@/app/components/DatabaseSelector";
import { WorkspaceSelector } from "@/app/components/WorkspaceSelector";
import { ModelSelector } from "@/app/components/ModelSelector";
import { listModelConfigs } from "@/lib/modelConfigs";
import { Label } from "@/components/ui/label";
import { WeintLogo } from "@/app/components/WeintLogo";
import { StatsLine } from "@/app/components/StatsLine";
import { ContextRing } from "@/app/components/ContextRing";
import { SubAgentProgressCard } from "@/app/components/SubAgentProgressCard";

interface ChatInterfaceProps {
  assistant: Assistant | null;
}

// ── 方案3：子任务终态失败但方案1未自动汇报 → 聊天流兜底占位（双保险）──
// 与后端 sync watcher 的 方案1 自动汇报范围对齐（error/timeout/cancelled）：
// interrupted（HITL 审批暂停）非失败终态，不兜底。
const FAIL_TERMINAL_STATUSES = new Set(["error", "timeout", "cancelled", "failed"]);
// 宽限期须大于方案1 最坏等主线程空闲的 30s（sync 忙则跳过不汇报），
// 否则方案1 汇报消息到达前占位已渲染 → 与 AI 汇报重复。
const FAIL_FALLBACK_GRACE_MS = 35000;
// ── 方案3 误报收敛：主 agent 已给出实质回答/说明 → 不兜底 ──
// 卡片自身文案「若上方 AI 未说明原因」——只有 AI 始终没给实质文本才兜底。
// 只扫当前会话边界（最后一条 human 之后）内的 AI 消息；纯工具调用（content 无 text）不算已说明。
const lastAiMessageHasExplanation = (msgs: Message[]): boolean => {
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m.type === "human") break; // 上一轮的回答不算「本轮已说明」
    if (m.type === "ai" && extractStringFromMessageContent(m).trim().length > 0) {
      return true;
    }
  }
  return false;
};
// eslint-disable  MS80OmFIVnBZMlhrdUp2bG43bmx2TG82VVVSdWNnPT06YjFiOWU4MzE=

export const ChatInterface = React.memo<ChatInterfaceProps>(({ assistant }) => {
  const [metaOpen, setMetaOpen] = useState<"tasks" | "files" | null>(null);
  // 已完成任务汇总行展开控制
  const [historyOpen, setHistoryOpen] = useState(false);
  // 运行中任务折叠控制（默认展开，点击标题折叠成单行）
  const [collapsedRunningIds, setCollapsedRunningIds] = useState<Set<string>>(new Set());
  // 子智能体进度卡片：追踪任务开始时间用于计算 elapsed
  const taskStartTimesRef = useRef<Map<string, number>>(new Map());
  // 选库：持久化到 localStorage，会话间保持
  const [selectedDb, setSelectedDb] = useState<string>(() => {
    try {
      return localStorage.getItem("selectedDb") || "aix_report";
    } catch {
      return "aix_report";
    }
  });
  // 选工作区：持久化到 localStorage
  const [selectedWorkspace, setSelectedWorkspace] = useState<string>(() => {
    try {
      return localStorage.getItem("selectedWorkspace") || "default";
    } catch {
      return "default";
    }
  });
  // 下拉框必须以「后端实际 active」为准：之前 selectedWorkspace 仅从 localStorage
  // 初始化，会残留旧值（如上次激活过 workspace1），而后端 active 可能已回退 default
  // → 下拉框显示 workspace1、实际运行时却走默认工作区。挂载时与 workspace-changed
  // 后用后端 active 校正；手动切换序号防止异步响应覆盖用户刚做的选择。
  const workspaceActionSeqRef = useRef(0);
  const syncWorkspaceFromBackend = useCallback(async () => {
    const seq = workspaceActionSeqRef.current;
    try {
      const info = await getActiveWorkspace();
      if (!info.active) return;
      if (workspaceActionSeqRef.current !== seq) return; // 用户已手动切换，丢弃过期校正
      setSelectedWorkspace(info.active);
      try {
        localStorage.setItem("selectedWorkspace", info.active);
      } catch {
        /* ignore */
      }
    } catch {
      /* 后端不可用时保持当前值 */
    }
  }, []);

  useEffect(() => {
    syncWorkspaceFromBackend();
    window.addEventListener("workspace-changed", syncWorkspaceFromBackend);
    return () =>
      window.removeEventListener("workspace-changed", syncWorkspaceFromBackend);
  }, [syncWorkspaceFromBackend]);
  // 选模型（P1-9）：modelId，持久化到 localStorage；空串 = 跟随激活 provider 默认模型
  const [selectedModel, setSelectedModel] = useState<string>(() => {
    try {
      return localStorage.getItem("selectedModel") || "";
    } catch {
      return "";
    }
  });
  // 所选模型所属 provider（llm_route）；空串 = 跟随激活 provider
  const [selectedProvider, setSelectedProvider] = useState<string>(() => {
    try {
      return localStorage.getItem("selectedProvider") || "";
    } catch {
      return "";
    }
  });
  // 是否已配置模型：后端不再回退 .env，未配置（或配置服务不可用）时禁止发送。
  const [modelConfigured, setModelConfigured] = useState<boolean | null>(null);

  // 拉取模型配置，判断是否有可用模型；配置弹窗保存/删除后（model-configs-changed）刷新。
  const refreshModelConfig = useCallback(async () => {
    try {
      const r = await listModelConfigs();
      // 至少一个 provider 且其 models 非空才视为「已配置」
      const hasModel = (r.providers || []).some(
        (p) => (p.models || []).some((m) => !!m.id)
      );
      setModelConfigured(hasModel);
    } catch {
      // 配置服务不可用也视为未配置（禁止发送，避免空请求打到后端）
      setModelConfigured(false);
    }
  }, []);

  useEffect(() => {
    refreshModelConfig();
    window.addEventListener("model-configs-changed", refreshModelConfig);
    return () =>
      window.removeEventListener("model-configs-changed", refreshModelConfig);
  }, [refreshModelConfig]);
  const tasksContainerRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // ── TTFT 测量（两步法）──
  // Step1：handleSubmit 设置 sendTimeRef → 当新 human 消息出现在 messages 中时，
  // 将发送时间写入 humanSendTimeMap[humanMsgId]，然后清零 sendTimeRef。
  // Step2：isLoading 期间，找到最后一条未配对的 human 消息，其后第一条有内容的
  // AI 消息即为该轮的响应，计算 TTFT。auto-continue 不设置 sendTimeRef，无 TTFT。
  const sendTimeRef = useRef<number>(0);
  const humanSendTimeMapRef = useRef<Record<string, number>>({}); // humanMsgId → 发送时间戳
  const pairedHumanIdsRef = useRef<Set<string>>(new Set()); // 已配对过 TTFT 的 human 消息
  const [ttftMap, setTtftMap] = useState<Record<string, number>>({}); // aiMessageId → TTFT ms
  const [msgDurationMap, setMsgDurationMap] = useState<Record<string, number>>({}); // aiMessageId → total ms
  const aiMsgStartRef = useRef<Record<string, number>>({}); // aiMessageId → start timestamp

  // 平均首 token 用时 = 各轮（已测到 TTFT）首 token 用时之和 / 轮数
  // 过滤超出合理范围的值（> 5 分钟视为测量异常，丢弃）
  const avgTtftMs = useMemo(() => {
    const values = Object.values(ttftMap).filter((v) => v > 0 && v <= 5 * 60 * 1000);
    if (values.length === 0) return undefined;
    return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
  }, [ttftMap]);

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
    threadId,
    messages,
    queryTasks,
    asyncTasks,
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
    tokenStats,
  } = useChatContext();

  // ── P1-3 SQL 审批：子 agent run_sql 被闸门 interrupt 后，sync 环路把
  // HITL payload 中继到 async_tasks[task].awaiting_approval，C 方案轮询读到
  // 后在此渲染审批卡；决策经后端恢复端点回传，子 run 自动继续。──────
  // resolvedApprovals：已提交决策的任务（乐观隐藏卡片，等轮询清除 awaiting_approval）
  const [resolvedApprovals, setResolvedApprovals] = useState<Set<string>>(new Set());
  const [approvingTaskIds, setApprovingTaskIds] = useState<Set<string>>(new Set());

  // ── 方案3：子任务终态失败兜底占位 ──
  // 任务进入 error/timeout/cancelled 终态且 方案1（sync watcher 自动汇报）未触发时，
  // 宽限期后往聊天流渲染「任务执行失败」占位（双保险：侧边栏已显示 ✕ + error 详情，
  // 聊天区若一直无 AI 说明，则前端兜底提示）。
  const [failedFallbackTasks, setFailedFallbackTasks] = useState<Set<string>>(new Set());
  const failedFallbackTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  // 定时器回调里读最新 async_tasks（effect 闭包里的 asyncTasks 会过期）
  const asyncTasksRef = useRef<Record<string, any>>({});
  asyncTasksRef.current = (asyncTasks as Record<string, any>) ?? {};
  // 定时器回调里读最新 messages / 运行态（effect 闭包里的会过期）
  const chatStatusRef = useRef<{ messages: Message[]; queryInProgress: boolean; isLoading: boolean }>({
    messages,
    queryInProgress,
    isLoading,
  });
  chatStatusRef.current = { messages, queryInProgress, isLoading };

  useEffect(() => {
    if (!asyncTasks || typeof asyncTasks !== "object") return;
    for (const [key, t] of Object.entries(asyncTasks as Record<string, any>)) {
      const taskId = t?.task_id || t?.thread_id || key;
      const status = t?.status;
      if (typeof taskId !== "string" || !taskId) continue;
      if (!FAIL_TERMINAL_STATUSES.has(status)) continue;        // 非失败终态
      if (failedFallbackTasks.has(taskId)) continue;            // 已渲染占位
      if (t?.failure_reported) continue;                        // 方案1已触发自动汇报
      if (failedFallbackTimersRef.current.has(taskId)) continue; // 已排程
      const timer = setTimeout(() => {
        failedFallbackTimersRef.current.delete(taskId);
        const latestT = asyncTasksRef.current[taskId] ?? asyncTasksRef.current[key];
        // 宽限期内方案1已上报 / 任务不再处于失败终态 → 不兜底
        if (latestT?.failure_reported || !FAIL_TERMINAL_STATUSES.has(latestT?.status ?? status)) {
          return;
        }
        const { messages: msgs, queryInProgress: running, isLoading: streaming } = chatStatusRef.current;
        // 主 agent 仍在运行（可能自愈/继续给出回答）→ 暂不兜底，
        // 运行结束后 effect 依赖翻转重排定时器再查一次，真·静默失败仍能兜底。
        if (running || streaming) return;
        // AI 已给出实质回答/说明 → 不兜底（卡片「若上方 AI 未说明原因」的前提不成立）
        if (lastAiMessageHasExplanation(msgs)) return;
        setFailedFallbackTasks((prev) => {
          const next = new Set(prev);
          next.add(taskId);
          return next;
        });
      }, FAIL_FALLBACK_GRACE_MS);
      failedFallbackTimersRef.current.set(taskId, timer);
    }
  }, [asyncTasks, failedFallbackTasks, queryInProgress, isLoading]);

  // 卸载清理未触发的兜底定时器
  useEffect(() => {
    const timers = failedFallbackTimersRef.current;
    return () => {
      timers.forEach((t) => clearTimeout(t));
      timers.clear();
    };
  }, []);

  const pendingApprovals = useMemo(() => {
    if (!asyncTasks || typeof asyncTasks !== "object") return [];
    return Object.entries(asyncTasks as Record<string, any>)
      .map(([id, t]) => {
        const taskId = t?.task_id || t?.thread_id || id;
        return { taskId, task: t };
      })
      .filter(
        ({ taskId, task }) =>
          Boolean(task?.awaiting_approval) && !resolvedApprovals.has(taskId)
      )
      .map(({ taskId, task }) => ({
        taskId,
        title: queryTasks.find((q) => q.task_id === taskId)?.title,
        approval: task.awaiting_approval as SqlApprovalPayload,
      }));
  }, [asyncTasks, resolvedApprovals, queryTasks]);

  // ── 子智能体进度卡片：从 queryTasks 派生进度数据，在输入区合并展示 ──
  // 单个任务 = 查询阶段（子智能体步骤）+ 结果阶段（图表/报告）
  // 任务开始时间优先取后端持久化的 created_at（async_tasks 随 thread state 重放，
  // 刷新页面不重置计时）；仅当该任务尚未带 created_at 时才用客户端首次可见时间兜底。
  const taskCreatedAt = useMemo(() => {
    const m = new Map<string, number>();
    if (asyncTasks && typeof asyncTasks === "object") {
      for (const [key, t] of Object.entries(asyncTasks as Record<string, any>)) {
        const taskId = t?.task_id || t?.thread_id || key;
        const ts = t?.created_at ? Date.parse(t.created_at) : NaN;
        if (typeof taskId === "string" && !Number.isNaN(ts)) m.set(taskId, ts);
      }
    }
    return m;
  }, [asyncTasks]);

  // 已完成任务的 task_id 集合：后端 async_tasks.status 已是终态（success/error/…）
  // 说明子智能体查询阶段已结束。若 active_queries 因重启竞态残留 true，前端不再
  // 渲染"执行中"卡片（否则已完成会话会永远显示一个从 0 涨的计时器）。
  const terminalTaskIds = useMemo(() => {
    const s = new Set<string>();
    const TERMINAL = new Set(["success", "error", "cancelled", "timeout", "interrupted", "failed"]);
    if (asyncTasks && typeof asyncTasks === "object") {
      for (const [key, t] of Object.entries(asyncTasks as Record<string, any>)) {
        const taskId = t?.task_id || t?.thread_id || key;
        if (typeof taskId === "string" && TERMINAL.has(t?.status)) s.add(taskId);
      }
    }
    return s;
  }, [asyncTasks]);

  const subAgentProgresses = useMemo(() => {
    return queryTasks
      .filter((qt) => qt.status === "running" && !terminalTaskIds.has(qt.task_id))
      .map((qt) => {
        const steps = qt.steps || [];
        const resultTodos = [
          ...(qt.chartStep ? [qt.chartStep] : []),
          ...(qt.reportStep ? [qt.reportStep] : []),
        ];
        const now = Date.now();
        let start = taskCreatedAt.get(qt.task_id);
        if (typeof start !== "number") {
          start = taskStartTimesRef.current.get(qt.task_id);
        }
        if (typeof start !== "number") {
          start = now;
          taskStartTimesRef.current.set(qt.task_id, start);
        }
        // 时钟偏移防御：created_at 晚于当前时间时归位到 now，避免负时长
        if (start > now) start = now;
        const elapsedMs = now - start;
        const elapsed =
          elapsedMs < 60000
            ? `${Math.floor(elapsedMs / 1000)}s`
            : `${Math.floor(elapsedMs / 60000)}m${Math.floor((elapsedMs % 60000) / 1000)}s`;

        return {
          taskId: qt.task_id,
          agentName: qt.agent_name || "nl2sql",
          queryTitle: qt.title || undefined,
          status: "running" as const,
          todos: steps,
          resultTodos,
          elapsed,
          latestThinking: null,
        };
      });
  }, [queryTasks, taskCreatedAt, terminalTaskIds]);

  // ── 并发多进度收缩：≥2 个 running 任务时自动折叠所有运行中卡片，省页面空间 ──
  // 折叠优先级：用户手动展开（userTouchedRunningIds 有该 taskId）> 自动折叠。
  // 单个任务时自动展开（除非用户手动折叠过）。
  const multiRunning = (subAgentProgresses?.length ?? 0) >= 2;
  // 用户主动点击过（展开/折叠）的任务：之后的自动折叠不再干预它
  const [userTouchedRunningIds, setUserTouchedRunningIds] = useState<Set<string>>(new Set());
  // 组级收缩（第 2 层）：≥2 个任务时把整个 running 区收缩为一行汇总，省页面空间。
  // 默认收缩；点击汇总行可展开各卡片 / 再收缩。单任务时无此控制行，不受影响。
  const [runningGroupCollapsed, setRunningGroupCollapsed] = useState(true);

  // ── P1-8 停止查询：输入区卡片「⏹ 停止」→ 后端取消子 run + 回写 cancelled ──
  // 取消后无需手动刷新：C 方案轮询拾取 cancelled 态，卡片自动移入「已结束」。
  const [cancellingTaskIds, setCancellingTaskIds] = useState<Set<string>>(new Set());
  const handleCancelTask = useCallback(
    async (taskId: string) => {
      if (!threadId) return;
      setCancellingTaskIds((prev) => new Set(prev).add(taskId));
      try {
        await cancelTask(taskId, threadId);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "取消失败，请重试";
        // 任务已自然结束（409）不视为错误，静默即可
        if (!msg.includes("已结束")) toast.error(msg);
      } finally {
        setCancellingTaskIds((prev) => {
          const next = new Set(prev);
          next.delete(taskId);
          return next;
        });
      }
    },
    [threadId]
  );

  const handleSqlApprovalDecision = useCallback(
    async (
      taskId: string,
      decision: SqlApprovalDecision,
      actionCount: number
    ) => {
      if (!threadId) return;
      setApprovingTaskIds((prev) => new Set(prev).add(taskId));
      try {
        // HITL 中间件要求 decisions 数量 == 被拦截调用数：单卡决策复制到全部
        await decideSqlApproval(taskId, {
          main_thread_id: threadId,
          decisions: Array.from(
            { length: Math.max(1, actionCount) },
            () => decision
          ),
          db_name: selectedDb,
        });
        setResolvedApprovals((prev) => new Set(prev).add(taskId));
      } catch (e) {
        const msg = e instanceof Error ? e.message : "审批提交失败，请重试";
        // 任务已无待审批 interrupt（刷新竞态/已被处理）→ 静默隐藏卡片
        if (msg.includes("没有待审批")) {
          setResolvedApprovals((prev) => new Set(prev).add(taskId));
        } else {
          toast.error(msg);
        }
      } finally {
        setApprovingTaskIds((prev) => {
          const next = new Set(prev);
          next.delete(taskId);
          return next;
        });
      }
    },
    [threadId, selectedDb]
  );

  // ── P1-1 消息反馈：threadId 变更时拉取该会话已有反馈，回显图标态 ──
  const [feedbackMap, setFeedbackMap] = useState<Record<string, FeedbackRecord>>({});
  useEffect(() => {
    let cancelled = false;
    if (!threadId) {
      setFeedbackMap({});
      return;
    }
    listThreadFeedback(threadId)
      .then((list) => {
        if (cancelled) return;
        const map: Record<string, FeedbackRecord> = {};
        for (const r of list) map[r.message_id] = r;
        setFeedbackMap(map);
      })
      .catch(() => {
        /* 反馈 API 不可用时不阻塞聊天 */
      });
    return () => {
      cancelled = true;
    };
  }, [threadId]);

  const handleFeedbackChange = useCallback(
    (messageId: string, feedback: FeedbackRecord | null) => {
      setFeedbackMap((prev) => {
        const next = { ...prev };
        if (feedback) {
          next[messageId] = feedback;
        } else {
          delete next[messageId];
        }
        return next;
      });
    },
    []
  );

  // ── P1-5 会话分叉：从某消息复制出截止到该消息的新会话并跳转 ──
  // 后端编排 copy+回退（/api/threads/{id}/fork）；成功后刷新会话列表并切到新会话。
  const [, setThreadIdParam] = useQueryState("threadId");
  const [forkingMessageId, setForkingMessageId] = useState<string | null>(null);
  const handleFork = useCallback(
    async (messageId: string) => {
      if (!threadId || forkingMessageId) return;
      setForkingMessageId(messageId);
      try {
        const res = await forkThread(threadId, messageId);
        // 刷新会话列表（ThreadList 监听 thread-title-updated 事件）
        window.dispatchEvent(new CustomEvent("thread-title-updated"));
        toast.success("已创建分叉会话，正在切换…");
        await setThreadIdParam(res.thread_id);
      } catch (e) {
        toast.error(`分叉失败：${e instanceof Error ? e.message : e}`);
      } finally {
        setForkingMessageId(null);
      }
    },
    [threadId, forkingMessageId, setThreadIdParam]
  );

  // ── P1-4 自动标题：新会话首条消息发出后，用 LLM 生成短标题写入 metadata.title ──
  // 提交时 threadId 尚不存在（由 useChat.onThreadId 回写 URL），先把首条文本记入
  // pendingTitleTextRef；threadId 出现后异步生成标题并写回，失败则不写
  // （会话列表自然回退到「首条消息截断」的占位标题）。
  const client = useClient();
  const pendingTitleTextRef = useRef<string | null>(null);
  useEffect(() => {
    const text = pendingTitleTextRef.current;
    if (!threadId || !text) return;
    pendingTitleTextRef.current = null;
    let cancelled = false;
    (async () => {
      const title = await generateAutoTitle(text);
      if (cancelled || !title) return;
      try {
        await setThreadTitle(client, threadId, title);
        // 通知会话列表立即刷新（ThreadList 监听该事件）
        window.dispatchEvent(new CustomEvent("thread-title-updated"));
      } catch {
        /* 写标题失败不影响聊天 */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [threadId, client]);

  // 发送可用性：智能体未就绪 / 未配置模型（后端不再回退 .env）时禁止发送。
  // 不再包含 isLoading —— 续跑 run 期间用户消息优先（sendMessage 会中断续跑）；
  // 用户 run（委派/用户消息）期间由 handleSubmit 提示稍候，但输入/回车始终可用。
  const submitDisabled = !assistant || !modelConfigured;

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
      // P1-4：新会话（尚无 threadId）记下首条文本，threadId 生成后自动出标题
      if (!threadId && messageText) pendingTitleTextRef.current = messageText;
      // 随消息传入 db_name（configurable → 后端主 agent → 透传子 agent run_sql）；
      // llm_route / llm_model（P1-9）：后端 ThinkingToggleMiddleware 按 provider + 模型重建模型，免重启切换
      // enable_thinking（P1-9）：前端「开启思考过程」开关 → 后端真实开/关思考
      const configurable: Record<string, string> = { db_name: selectedDb };
      if (selectedProvider) configurable.llm_route = selectedProvider;
      if (selectedModel) configurable.llm_model = selectedModel;
      configurable.enable_thinking = getEnableThinking() ? "true" : "false";
      sendTimeRef.current = Date.now(); // TTFT 测量：记录发送时间
      sendMessage(messageText, contentBlocks, configurable);
      setInput("");
      resetBlocks();
    },
    [
      input, contentBlocks, isLoading, sendMessage, submitDisabled,
      runningQueryCount, queryInProgress, isQueryMessage,
      currentContinueTaskKeyRef, selectedDb, selectedModel, selectedProvider, threadId,
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
          } as ToolCall;
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

    // ── 跨消息图表去重：同一图表可能来自消息正文（bodyIframes）或工具调用结果
    // （toolIframes），用 src 前 100 字符做指纹，全局只保留首次出现。 ──
    const seenChartFingerprints = new Set<string>();
    const getFingerprint = (iframeHtml: string) => {
      const srcMatch = iframeHtml.match(/src="([^"]+)"/);
      // 用完整 src 做精确比较：不同图表 base64 不同，相同图表 base64 相同。
      return srcMatch ? srcMatch[1] : iframeHtml;
    };
    for (const data of processedArray) {
      if (data.message.type !== "ai") continue;

      // 1) 从消息正文收集 iframe
      const content = extractStringFromMessageContent(data.message) || "";
      const bodyIframes = extractInteractiveChartIframes(content);

      // 2) 从图表工具调用结果收集 iframe
      const toolIframes: Array<{ index: number; html: string }> = [];
      data.toolCalls.forEach((tc, idx) => {
        if (!tc.result || typeof tc.result !== "string") return;
        const isChartTool = chartToolNames.some(
          (n) => tc.name === n || (tc.name || "").includes(n)
        );
        if (!isChartTool) return;
        const iframes = extractInteractiveChartIframes(tc.result);
        for (const html of iframes) {
          toolIframes.push({ index: idx, html });
        }
      });

      // 3) 合并所有来源，标记重复
      const allIframes = [
        ...bodyIframes.map((h) => ({ html: h, source: "body" as const })),
        ...toolIframes.map((t) => ({ html: t.html, source: "tool" as const, index: t.index })),
      ];
      const bodyToRemove: string[] = [];
      const toolIndicesToClear: number[] = [];
      for (const item of allIframes) {
        const fp = getFingerprint(item.html);
        if (seenChartFingerprints.has(fp)) {
          if (item.source === "body") bodyToRemove.push(item.html);
          else toolIndicesToClear.push((item as any).index);
        } else {
          seenChartFingerprints.add(fp);
        }
      }

      // 4) 从正文中剥离重复 iframe
      if (bodyToRemove.length > 0 && typeof data.message.content === "string") {
        let newContent = data.message.content;
        for (const iframe of bodyToRemove) {
          newContent = newContent.replace(iframe, "");
        }
        data.message = { ...data.message, content: newContent };
      }
      // 5) 清除重复的图表工具调用结果
      for (const idx of toolIndicesToClear) {
        data.toolCalls[idx] = { ...data.toolCalls[idx], result: "" };
      }
    }

    let roundIndex = 0;
    const withShowAvatar = processedArray.map((data, index) => {
      const prevMessage = index > 0 ? processedArray[index - 1].message : null;
      if (data.message.type === "human") roundIndex += 1;
      return {
        ...data,
        showAvatar: data.message.type !== prevMessage?.type,
        roundIndex,
      };
    });

    return withShowAvatar as Array<{
      message: Message;
      toolCalls: ToolCall[];
      showAvatar: boolean;
      roundIndex: number;
    }>;
  }, [messages, interrupt]);

  // 每轮 token 维度：按后端 steps[].round_index 聚合（轮号 = human 消息计数）。
  // 每轮可能有多步 LLM 调用（主 agent + 子 agent），累加得到该轮总计。
  const roundStatsMap = useMemo(() => {
    const map = new Map<
      number,
      { llmMs: number; input: number; output: number; cacheRead: number }
    >();
    for (const s of tokenStats?.steps ?? []) {
      const r = s.round_index;
      if (!r) continue; // round_index 0 = 后端无法判定，跳过
      const cur = map.get(r) ?? { llmMs: 0, input: 0, output: 0, cacheRead: 0 };
      cur.llmMs += s.total_llm_ms ?? 0;
      cur.input += s.total_input_tokens ?? 0;
      cur.output += s.total_output_tokens ?? 0;
      cur.cacheRead += s.total_cache_read_tokens ?? 0;
      map.set(r, cur);
    }
    return map;
  }, [tokenStats]);

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
    // pendingApprovals.length：审批卡出现时也滚动到底部，确保用户看得到
  }, [lastMessageId, processedMessages.length, isLoading, scrollRef, pendingApprovals.length]);

  // ── TTFT 测量（两步法）──
  // Step1：handleSubmit 设置 sendTimeRef → 当新 human 消息出现在 messages 中时，
  // 将发送时间写入 humanSendTimeMap[humanMsgId]，然后清零 sendTimeRef。
  useEffect(() => {
    if (sendTimeRef.current === 0) return;
    const humanMsgs = messages.filter((m) => m.type === "human");
    for (const hm of humanMsgs) {
      if (!hm.id || humanSendTimeMapRef.current[hm.id]) continue;
      // 新 human 消息：记录发送时间
      humanSendTimeMapRef.current[hm.id] = sendTimeRef.current;
      sendTimeRef.current = 0;
      break; // 只处理第一个新 human
    }
  }, [messages]);

  // Step2：isLoading 期间，找到最新未配对的 human 消息，其后第一条有内容的
  // AI 消息即为该轮响应，计算 TTFT。auto-continue 不设置 sendTimeRef，无 TTFT。
  useEffect(() => {
    if (!isLoading) return;
    // 找到最新未配对的 human 消息
    const humanMsgs = messages.filter((m) => m.type === "human");
    let targetHumanId: string | null = null;
    for (let i = humanMsgs.length - 1; i >= 0; i--) {
      const hid = humanMsgs[i].id;
      if (hid && humanSendTimeMapRef.current[hid] && !pairedHumanIdsRef.current.has(hid)) {
        targetHumanId = hid;
        break;
      }
    }
    if (!targetHumanId) return;
    const sendAt = humanSendTimeMapRef.current[targetHumanId];
    // 防御：时间戳异常则跳过
    if (sendAt <= 0) return;
    // 找到该 human 消息之后第一条有内容的 AI 消息
    const targetHumanIdx = messages.findIndex((m) => m.id === targetHumanId);
    if (targetHumanIdx < 0) return;
    for (let j = targetHumanIdx + 1; j < messages.length; j++) {
      const m = messages[j];
      if (m.type !== "ai" || !m.id) continue;
      if (ttftMap[m.id]) continue;
      const content = extractStringFromMessageContent(m) || "";
      if (!content.trim()) continue;
      const now = Date.now();
      const delta = now - sendAt;
      if (delta <= 0 || delta > 30 * 60 * 1000) {
        pairedHumanIdsRef.current.add(targetHumanId); // 异常也标记配对，避免死循环
        return;
      }
      setTtftMap((prev) => ({ ...prev, [m.id]: delta }));
      aiMsgStartRef.current[m.id] = sendAt;
      pairedHumanIdsRef.current.add(targetHumanId);
      break;
    }
  }, [messages, isLoading, ttftMap]);

  // 当流式结束（isLoading true→false）：记录 duration、重置
  const prevLoadingRef = useRef(isLoading);
  useEffect(() => {
    if (prevLoadingRef.current && !isLoading) {
      const aiMessages = messages.filter((m) => m.type === "ai");
      const updates: Record<string, number> = {};
      for (const m of aiMessages) {
        if (m.id && aiMsgStartRef.current[m.id] && !msgDurationMap[m.id]) {
          updates[m.id] = Date.now() - aiMsgStartRef.current[m.id];
        }
      }
      if (Object.keys(updates).length > 0) {
        setMsgDurationMap((prev) => ({ ...prev, ...updates }));
      }
    }
    prevLoadingRef.current = isLoading;
  }, [isLoading, messages, msgDurationMap]);
  const isIdle = !isThreadLoading && processedMessages.length === 0;

  return (
    <div className={cn("flex flex-1 flex-col overflow-hidden", isIdle && "justify-center")}>
      {isIdle ? (
        <div className="flex flex-none flex-col items-center px-6 pb-10">
          <WeintLogo size={36} />
          <h1 className="mt-6 text-3xl font-semibold tracking-tight text-foreground">
            探索未至之境
          </h1>
        </div>
      ) : (
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
                    threadId={threadId ?? undefined}
                    feedback={
                      data.message.id
                        ? feedbackMap[data.message.id] ?? null
                        : null
                    }
                    dbContext={selectedDb}
                    onFeedbackChange={handleFeedbackChange}
                    onFork={handleFork}
                    forkBusy={forkingMessageId !== null}
                    ttftMs={data.message.id ? ttftMap[data.message.id] : undefined}
                    durationMs={data.message.id ? msgDurationMap[data.message.id] : undefined}
                    roundStat={roundStatsMap.get(data.roundIndex)}
                  />
                );
              })}

              {/* 方案3：子任务终态失败但方案1未自动汇报 → 聊天流兜底失败占位（双保险） */}
              {failedFallbackTasks.size > 0 && (
                <div className="flex flex-col gap-2 pt-2">
                  {Array.from(failedFallbackTasks).map((taskId) => {
                    const t = (asyncTasks as Record<string, any>)?.[taskId];
                    const title =
                      queryTasks.find((q) => q.task_id === taskId)?.title ||
                      t?.description ||
                      "子任务";
                    const err = typeof t?.error === "string" ? t.error : "";
                    const isCancelled = t?.status === "cancelled";
                    return (
                      <div
                        key={`fail-fallback-${taskId}`}
                        className="flex flex-col gap-1 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm"
                      >
                        <div className="flex items-center gap-2 text-destructive">
                          <AlertCircle size={15} className="shrink-0" />
                          <span className="font-medium">
                            子任务「{title}」{isCancelled ? "已被取消" : "执行失败"}
                          </span>
                        </div>
                        {err && (
                          <div className="break-words pl-6 text-xs text-muted-foreground">
                            {err}
                          </div>
                        )}
                        <div className="pl-6 text-xs text-muted-foreground">
                          若上方 AI 未说明原因，可重试该查询或在侧边栏查看任务详情。
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      </div>
      )}

      <div className="flex-shrink-0 bg-background">
        <div
          ref={dropRef}
          className={cn(
            "mx-4 mb-6 flex flex-shrink-0 flex-col overflow-hidden rounded-xl border border-border bg-background",
            "mx-auto w-[calc(100%-32px)] max-w-[896px] transition-colors duration-200 ease-in-out",
            dragOver && "border-primary border-2 border-dotted"
          )}
        >
          {(hasFiles || queryTasks.length > 0) && (
            <div className="flex max-h-72 flex-col overflow-y-auto border-b border-border bg-sidebar empty:hidden">
              {!metaOpen && (
                <>
                  {/* 并发多查询进度（running 彩色卡片 / 已完成汇总） */}
                  {queryTasks.length > 0 && (() => {
                    // 分组：running 任务 + 已完成任务（汇总一行，点击展开）
                    // 后端 async_tasks 终态但 active_queries 残留 true 的任务也算已完成
                    //（否则"已完成会话"会被漏计数、或消失不见）
                    const doneTasks = queryTasks.filter(
                      (t) => t.status !== "running" || terminalTaskIds.has(t.task_id)
                    );

                    return (
                      <div className="flex flex-col divide-y divide-border">
                        {/* 1. running 任务：组级收缩行 + 彩色进度卡片
                            - 第 1 层：单卡片点击标题折叠（用户手动 / 并发≥2 自动）
                            - 第 2 层：≥2 个任务时整体收缩为一行汇总（默认收缩，省页面空间） */}
                        {multiRunning && (
                          <div className="px-[18px] py-2">
                            <button
                              type="button"
                              className="flex w-full cursor-pointer items-center gap-2 text-sm"
                              onClick={() => setRunningGroupCollapsed((v) => !v)}
                              title={runningGroupCollapsed ? "展开各查询进度" : "收缩为一行汇总"}
                            >
                              <Loader2 size={14} className="shrink-0 animate-spin text-blue-500" />
                              <span className="font-medium text-foreground">
                                {subAgentProgresses.length} 个查询进行中
                              </span>
                              <span className="ml-2 min-w-0 flex-1 truncate text-right text-xs text-muted-foreground">
                                {subAgentProgresses
                                  .map((p) => {
                                    const all = [...(p.todos || []), ...(p.resultTodos || [])];
                                    const done = all.filter((s) => s.status === "completed").length;
                                    return `${p.agentName} ${done}/${all.length}`;
                                  })
                                  .join(" · ")}
                              </span>
                              <span className="shrink-0 text-xs text-muted-foreground">
                                {runningGroupCollapsed ? "▸" : "▾"}
                              </span>
                            </button>
                          </div>
                        )}
                        {(!runningGroupCollapsed || !multiRunning) &&
                          subAgentProgresses.map((p) => {
                            const userTouched = userTouchedRunningIds.has(p.taskId);
                            const collapsed =
                              userTouched
                                ? collapsedRunningIds.has(p.taskId) // 用户手动操作过：以其折叠态为准
                                : multiRunning; // 未操作过：并发≥2 自动折叠，单任务自动展开
                            return (
                              <div key={p.taskId} className="px-[18px] py-1.5">
                                <SubAgentProgressCard
                                  progress={p}
                                  fullWidth
                                  collapsed={collapsed}
                                  onToggle={() => {
                                    // 记录用户主动操作，之后的自动折叠不再覆盖它
                                    setUserTouchedRunningIds((prev) => {
                                      const next = new Set(prev);
                                      next.add(p.taskId);
                                      return next;
                                    });
                                    setCollapsedRunningIds((prev) => {
                                      const next = new Set(prev);
                                      if (next.has(p.taskId)) next.delete(p.taskId);
                                      else next.add(p.taskId);
                                      return next;
                                    });
                                  }}
                                  onCancel={() => handleCancelTask(p.taskId)}
                                  cancelling={cancellingTaskIds.has(p.taskId)}
                                />
                              </div>
                            );
                          })}

                        {/* 2. 已终止任务：汇总一行，点击展开全部列表（计数与内容一致）
                            P1-7：区分成功/失败/取消/超时——非全部成功时标「已结束」，
                            展开行按状态给图标（✓ 成功 / ✕ 失败 / ⊘ 取消·超时·中断） */}
                        {doneTasks.length > 0 && (() => {
                          const allSuccess = doneTasks.every((t) => t.status === "success");
                          const doneIcon = (st: string) =>
                            st === "success" ? "✓" : st === "error" ? "✕" : "⊘";
                          return (
                          <div className="px-[18px] py-2">
                            <button
                              type="button"
                              className="flex w-full cursor-pointer items-center gap-2 text-sm"
                              onClick={() => setHistoryOpen((v) => !v)}
                            >
                              <CheckCircle size={14} className={allSuccess ? "text-success/80 shrink-0" : "text-muted-foreground shrink-0"} />
                              <span className="font-medium text-foreground">
                                {allSuccess
                                  ? `✅ 已完成 ${doneTasks.length} 个查询`
                                  : `🏁 已结束 ${doneTasks.length} 个查询`}
                              </span>
                              <span className="ml-auto shrink-0 text-xs text-muted-foreground">{historyOpen ? "▾" : "▸"}</span>
                            </button>
                            {historyOpen && (
                              <div className="mt-1.5 flex flex-col">
                                {doneTasks.map((qt) => {
                                  const qtErr = (asyncTasks as Record<string, any>)?.[qt.task_id]?.error as string | undefined;
                                  return (
                                    <div key={qt.task_id} className="flex flex-col gap-0.5 py-1 text-xs text-muted-foreground">
                                      <div className="flex items-center gap-2">
                                        <span className="w-3 shrink-0 text-center">{doneIcon(qt.status)}</span>
                                        <span className="truncate" title={qtErr || undefined}>{qt.title}</span>
                                      </div>
                                      {qtErr && (
                                        <div className="truncate pl-5 text-red-400" title={qtErr}>{qtErr}</div>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                          );
                        })()}
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
          {/* P1-3 SQL 审批卡：渲染在 composer 正上方 */}
          {pendingApprovals.map(({ taskId, title, approval }) => (
            <SqlApprovalCard
              key={`sql-approval-${taskId}`}
              taskId={taskId}
              title={title}
              approval={approval}
              busy={approvingTaskIds.has(taskId)}
              onDecide={handleSqlApprovalDecision}
            />
          ))}
          <form
            onSubmit={handleSubmit}
            className="flex flex-col"
          >
            <StatsLine avgTtftMs={avgTtftMs} />
            <ContentBlocksPreview
              blocks={contentBlocks}
              onRemove={removeBlock}
            />
            {modelConfigured === false && (
              <div className="px-[18px] pt-2 text-xs text-amber-600 dark:text-amber-400">
                尚未配置模型，无法发送消息。请点击右上角「设置」添加可用模型。
              </div>
            )}
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
                </Label>
                <input
                  id="file-input"
                  type="file"
                  onChange={handleFileUpload}
                  multiple
                  accept="image/jpeg,image/png,image/gif,image/webp,application/pdf"
                  className="hidden"
                />
                <WorkspaceSelector
                  value={selectedWorkspace}
                  onChange={(v) => {
                    workspaceActionSeqRef.current += 1;
                    setSelectedWorkspace(v);
                    try {
                      localStorage.setItem("selectedWorkspace", v);
                    } catch {
                      /* ignore */
                    }
                  }}
                />
                <DatabaseSelector
                  value={selectedDb}
                  onChange={(v) => {
                    setSelectedDb(v);
                    try {
                      localStorage.setItem("selectedDb", v);
                    } catch {
                      /* ignore */
                    }
                  }}
                />
              </div>
              <div className="flex justify-end gap-2">
                <ModelSelector
                  value={selectedModel}
                  provider={selectedProvider}
                  onChange={(sel) => {
                    setSelectedModel(sel.modelId);
                    setSelectedProvider(sel.provider);
                    try {
                      localStorage.setItem("selectedModel", sel.modelId);
                      localStorage.setItem("selectedProvider", sel.provider);
                    } catch {
                      /* ignore */
                    }
                  }}
                />
                <ContextRing
                  selectedModel={selectedModel}
                  selectedProvider={selectedProvider}
                />
                <Button
                  type={isLoading ? "button" : "submit"}
                  variant={isLoading ? "destructive" : "default"}
                  className={isLoading ? undefined : "bg-[hsl(180_50%_42%)] hover:bg-[hsl(180_50%_37%)]"}
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
    </div>
  );
});

ChatInterface.displayName = "ChatInterface";
// FIXME  My80OmFIVnBZMlhrdUp2bG43bmx2TG82VVVSdWNnPT06YjFiOWU4MzE=
