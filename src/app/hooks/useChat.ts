"use client";
// TODO  MC80OmFIVnBZMlhrdUp2bG43bmx2TG82YlU1amRRPT06N2RjMGNjZmI=

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStream } from "@langchain/langgraph-sdk/react";
import {
  type Message,
  type Assistant,
  type Checkpoint,
  Client,
} from "@langchain/langgraph-sdk";
import { v4 as uuidv4 } from "uuid";
import type { UseStreamThread } from "@langchain/langgraph-sdk/react";
import type { TodoItem, QueryTask } from "@/app/types/types";
import { useClient } from "@/providers/ClientProvider";
import { useQueryState } from "nuqs";
import { ContentBlock } from "@langchain/core/messages";
import { getQueryKeywords, getConfig, getEnableThinking, getSqlApprovalPolicy } from "@/lib/config";
// FIXME  MS80OmFIVnBZMlhrdUp2bG43bmx2TG82YlU1amRRPT06N2RjMGNjZmI=

// ── 从子线程消息推导查询步骤（write_todos 未调用时的兜底）──
// write_todos 依赖 LLM 自愿调用，偶尔会缺失；此时子线程消息里的工具调用序列
// 仍是可靠的步骤来源（read_file 加载各 skill → wrenai 检索 → dry_run → run_sql）。
// 按工具名映射为人类可读的流水线阶段，顺序即执行顺序，状态按是否有返回结果判定。
function deriveStepsFromSubMessages(messages: unknown[]): TodoItem[] {
  if (!Array.isArray(messages) || messages.length === 0) return [];
  // 第一遍：收集所有已返回结果的 tool_call_id
  const returnedIds = new Set<string>();
  for (const m of messages) {
    const msg = (m ?? {}) as any;
    const role = msg?.type || msg?.role;
    if (role === "tool" && msg?.tool_call_id) returnedIds.add(msg.tool_call_id);
  }
  // 第二遍：按顺序收集 AI 工具调用 → 映射阶段名
  const steps: TodoItem[] = [];
  const seen = new Set<string>(); // 去重（同一阶段可能多次调用）
  for (const m of messages) {
    const msg = (m ?? {}) as any;
    const role = msg?.type || msg?.role;
    const tcs = msg?.tool_calls;
    if (role !== "ai" && role !== "assistant") continue;
    if (!Array.isArray(tcs)) continue;
    for (const tc of tcs) {
      const name = tc?.name || "";
      const args = (tc?.args ?? {}) as any;
      let label = "";
      const filePath = String(args?.file_path || "");
      if (name === "read_file") {
        // 从 skill 路径提取阶段名：skills/nl2sql/<stage>/SKILL.md
        // 阶段目录本身可能带 nl2sql- 前缀（如 nl2sql-knowledge-loader），去掉保持简洁
        const m = filePath.match(/skills\/nl2sql\/(?:nl2sql-)?([^/]+)\/SKILL\.md/i);
        if (m) {
          const stage = m[1].replace(/-/g, " ");
          label = `${stage} 技能加载`;
        } else if (filePath.includes("knowledge")) {
          label = "加载业务知识";
        } else {
          label = "读取文件";
        }
      } else if (name === "write_file") {
        label = "保存中间结果";
      } else if (name === "wrenai_run_sql" || name === "run_sql") {
        label = "执行 SQL 查询";
      } else if (name === "wrenai_dry_run" || name === "dry_run") {
        label = "SQL 语法验证";
      } else if (name === "wrenai_get_context") {
        label = "语义检索相关 Schema";
      } else if (name === "wrenai_get_mdl" || name === "wrenai_list_models" || name === "wrenai_describe_schema" || name === "wrenai_list_cubes" || name === "describe_model") {
        label = "获取数据库 Schema";
      } else if (name === "wrenai_get_instructions" || name === "wrenai_recall_queries" || name === "wrenai_list_knowledge" || name === "wrenai_list_stored_queries") {
        label = "检索知识库与示例";
      } else if (name === "ls") {
        label = "浏览文件目录";
      } else if (name) {
        // 其他工具：用工具名展示（去掉 wrenai_ 前缀）
        label = name.replace(/^wrenai_/, "");
      }
      if (!label) continue;
      if (seen.has(label)) continue; // 同一阶段只显示一次
      seen.add(label);
      const done = returnedIds.has(tc?.id);
      steps.push({
        id: `__msgstep_${tc?.id || `${name}_${steps.length}`}`,
        content: label,
        status: done ? "completed" : "in_progress",
      });
    }
  }
  return steps;
}

// ── 清洗任务标题 ──
// start_async_task 的 description 是完整 prompt（【任务目标】...【数据库名称】...），
// 且【任务目标】后常带系统注入说明（"注意：子智能体会自动选择最优策略..."、
// "调用 run_sql 时传 db_name=..."）。这里只保留用户原始问题，去掉：
//  1. 下一个【 分段标记之后的 prompt 内容
//  2. "注意"（系统注入的固定开头）之后的内容
//  3. 首尾空白与冗余标点
function cleanTaskTitle(raw: string): string {
  let t = (raw || "").trim();
  if (!t) return t;
  // 去掉【任务目标】标记前缀本身（若整段是 prompt）
  const goalIdx = t.indexOf("【任务目标】");
  if (goalIdx >= 0) t = t.slice(goalIdx + "【任务目标】".length).trim();
  // 截断到下一个【 分段标记
  const nextSection = t.indexOf("【");
  if (nextSection > 0) t = t.slice(0, nextSection).trim();
  // 截断系统注入说明："注意"是固定的注入开头（如"注意：子智能体会自动选择最优策略..."）。
  // 用户问题中几乎不会以"注意"收尾，用它作为边界比句号更安全（问题里可能含句号）。
  const noticeIdx = t.indexOf("注意");
  if (noticeIdx > 0) t = t.slice(0, noticeIdx).trim();
  // 去掉结尾冗余标点
  t = t.replace(/[。.；;，,]+$/, "").trim();
  return t;
}

// 从主 todos 直接匹配「图表」/「报告」条目（不要求标题关键词重合）。
// 查询类任务主 todos 恒为 [委派, 推荐并渲染图表, 生成分析报告]，图表/报告各一条；
// 活跃续跑任务（currentContinueTaskKeyRef 命中）的图表/报告进度以此为准，
// 拿到真实的 in_progress → completed 变化。通用模板 desc（"推荐并渲染"）与
// 查询标题关键词常不重合，matchChartReport 的 content 匹配会失败，故用直配兜底。
function findReportTodo(todos: TodoItem[], kind: "图表" | "报告"): TodoItem | null {
  if (!Array.isArray(todos)) return null;
  for (const t of todos) {
    const c = t.content || "";
    if (kind === "图表" && c.includes("图表")) return t;
    if (kind === "报告" && c.includes("报告")) return t;
  }
  return null;
}

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
  query_header?: TodoItem;        // 查询标题（后端独立字段）
  subagent_steps?: TodoItem[];    // 子智能体步骤（后端独立字段）
  // 并发多查询：按 task_id 键控字段
  query_headers?: Record<string, TodoItem>;
  subagent_steps_map?: Record<string, TodoItem[]>;
  active_queries?: Record<string, boolean>;
  async_tasks?: Record<string, any>;
  // Token 计量（累积型）
  token_stats?: {
    total_llm_ms: number;
    total_input_tokens: number;
    total_output_tokens: number;
    total_cache_read_tokens: number;
    total_reasoning_tokens: number;
    step_count: number;
    steps: Array<{
      total_llm_ms: number;
      total_input_tokens: number;
      total_output_tokens: number;
      total_cache_read_tokens: number;
      total_reasoning_tokens: number;
      round_index?: number;
    }>;
  };
};

// P1-7：async_tasks 终态集合（对齐后端 deepagents _TERMINAL_STATUSES）。
// busy 判定用：终态任务不再驱动 1s 轮询。注意 auto-continue 仍只对
// success/error 触发——cancelled 是用户主动取消，不得自动续跑。
const TERMINAL_TASK_STATUSES = new Set([
  "success",
  "error",
  "cancelled",
  "timeout",
  "interrupted",
]);

// auto-continue 只对 success 触发，error/cancelled/timeout/interrupted 不自动续跑
const AUTO_CONTINUE_STATUSES = new Set(["success"]);
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

  // BUG A 修复：轮询专用 client，与提交路径(client)各自独立的 AsyncCaller 请求队列。
  // 轮询 getState 的洪泛/缓慢不再占用提交队列，续跑 run 结束后 onSuccess 的
  // history.mutate 立即执行，不会因排队饿死而把 isLoading 卡在「停止」。
  // SDK v1.0.3 的主 Client 是壳类：apiUrl/defaultHeaders/AsyncCaller 都挂在子 client
  // （client.threads / client.assistants 等，各自继承 BaseClient）上，主 Client 上没有这些字段。
  // 因此从 client.threads 读取同一后端/鉴权配置，而不是 (client as any).apiUrl（恒为 undefined）。
  const pollClient = useMemo(
    () =>
      new Client({
        apiUrl: (client as any)?.threads?.apiUrl,
        defaultHeaders: { ...((client as any)?.threads?.defaultHeaders || {}) },
      }),
    [client]
  );

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
    assistantId: activeAssistant?.assistant_id ||
      (typeof window !== "undefined" ? getConfig()?.assistantId : "") || "", // 422 修复: assistant 未加载(null)时回退 config.assistantId(graph 名是后端合法目标)
    client: client ?? undefined,
    reconnectOnMount: false, // 禁用预存的重连机制：残留 lg:stream:{threadId} 条目会导致 joinStream 重放整个 run 历史(巨大)并使 isLoading 卡死, 阻塞输入; 恢复由 Loop A 轮询 + Loop B auto-continue 承担
    threadId: threadId ?? null,
    onThreadId: setThreadId,
    defaultHeaders: { "x-auth-scheme": "langsmith" },
    // 只取最新状态(limit=1): 历史端点每个 checkpoint 都带全量累积消息, O(N×消息数)超线性耗时, limit=10 实测 15.5s/3.3MB;
    // 前端不用分支历史, limit=1 实测 1.7s。注意不可用 false(会让 SDK 的 history getter 抛错)
    fetchStateHistory: { limit: 1 },
    // Revalidate thread list after paint to avoid blocking the chat UI
    onFinish: scheduleHistoryRevalidate,
    onError: scheduleHistoryRevalidate,
    onCreated: scheduleHistoryRevalidate,
    experimental_thread: thread,
  });

  // BUG A 修复：SDK 的 useStream() 每次 render 都返回新对象字面量，stream 引用不稳定。
  // 轮询 effect 内部一律经 streamRef 读最新值（isLoading/submit），
  // 不把 stream 放进 effect deps，杜绝「每次 render 重跑 → getState 洪泛」。
  const streamRef = useRef(stream);
  streamRef.current = stream;

  // ── 定时刷新 todos（捕获外部 update_state 的变更）──
  // 后端同步进程会定期将子智能体进度写入主智能体 state，
  // 但 stream.values 只在 run 产生事件时更新，不会自动反映外部变更。
  // 通过定时 getState() 轮询来补偿。
  const [polledTodos, setPolledTodos] = useState<TodoItem[] | null>(null);
  const [polledQueryHeader, setPolledQueryHeader] = useState<TodoItem | null>(null);
  const [polledSubagentSteps, setPolledSubagentSteps] = useState<TodoItem[] | null>(null);
  const [polledQueryActive, setPolledQueryActive] = useState<boolean | null>(null);
  // 并发多查询：按 task_id 键控的字段
  const [polledQueryHeaders, setPolledQueryHeaders] = useState<Record<string, TodoItem> | null>(null);
  const [polledSubagentStepsMap, setPolledSubagentStepsMap] = useState<Record<string, TodoItem[]> | null>(null);
  const [polledActiveQueries, setPolledActiveQueries] = useState<Record<string, boolean> | null>(null);
  const [polledAsyncTasks, setPolledAsyncTasks] = useState<Record<string, any> | null>(null);
  const [polledSubagentTodos, setPolledSubagentTodos] = useState<Record<string, TodoItem[]> | null>(null);
  const [polledSubagentTitles, setPolledSubagentTitles] = useState<Record<string, string> | null>(null);
  const [polledTaskTitles, setPolledTaskTitles] = useState<Record<string, string> | null>(null);
  // 缓存：防止新 run 从旧 checkpoint 加载导致字段丢失
  const cachedQueryHeaderRef = useRef<TodoItem | null>(null);
  const cachedSubagentStepsRef = useRef<TodoItem[] | null>(null);
  const cachedQueryHeadersRef = useRef<Record<string, TodoItem> | null>(null);
  const cachedSubagentStepsMapRef = useRef<Record<string, TodoItem[]> | null>(null);
  const lastHumanMsgIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!threadId) {
      setPolledTodos(null);
      return;
    }
    let active = true;
    // C 方案（按需轮询）：活跃（有 run / 运行中子任务）时 1s 轮询，空闲时降为 10s，
    // 减少空转 getState 与对 checkpoint 的读写竞争。
    // 调整为 1s：匹配后端 sync 的 0.5s 写入周期，降低进度更新延迟。
    let timer: ReturnType<typeof setTimeout> | undefined;
    let busy = false;
    const poll = async () => {
      try {
        const state = await pollClient.threads.getState(threadId);
        if (!active) return;
        const values = state?.values as any;
        const todos = values?.todos;
        if (Array.isArray(todos)) {
          setPolledTodos(todos);
        }
        // 读取独立字段（不被 write_todos 覆盖）
        const qh = values?.query_header ?? null;
        const ss = values?.subagent_steps ?? null;
        // 查询进行中权威标记（后端 sync 进程写入）
        setPolledQueryActive(values?.query_active ?? null);
        // 并发多查询：读取按 task_id 键控的字段
        setPolledQueryHeaders(values?.query_headers ?? null);
        setPolledSubagentStepsMap(values?.subagent_steps_map ?? null);
        setPolledActiveQueries(values?.active_queries ?? null);
        setPolledAsyncTasks(values?.async_tasks ?? null);
        // 缓存 keyed 字段（防 checkpoint 重载丢失）
        if (values?.query_headers && Object.keys(values.query_headers).length > 0) {
          cachedQueryHeadersRef.current = values.query_headers;
        }
        if (values?.subagent_steps_map && Object.keys(values.subagent_steps_map).length > 0) {
          cachedSubagentStepsMapRef.current = values.subagent_steps_map;
        }
        // ── 从子线程 state 读取每个任务的 todos（作为进度）──
        // 前端自行从子线程提取步骤进度，不依赖后端 keyed 字段的并发合并。
        // 子线程 ID = task_id（thread_id == task_id），按任务隔离，不会识别错问题。
        const asyncTasks = values?.async_tasks;
        // C 方案（按需轮询）：活跃判定——有 run 进行中或有运行中的子任务时才按需轮询，
        // 空闲时跳过子线程轮询并放宽间隔，减少 getState 对 checkpoint 的竞争。
        const activeQueriesLocal = values?.active_queries;
        const subTaskRunning =
          (asyncTasks && typeof asyncTasks === "object" &&
            Object.values(asyncTasks).some((t: any) => {
              const st = t?.status;
              return st !== "success" && st !== "error";
            })) ||
          (activeQueriesLocal && typeof activeQueriesLocal === "object" &&
            Object.values(activeQueriesLocal).some((v) => v === true));
        // 经 streamRef 读最新 isLoading：effect deps 不含 stream，直接引用会冻结为挂载时快照
        busy = streamRef.current.isLoading || subTaskRunning;
        if (asyncTasks && typeof asyncTasks === "object" && busy) {
          const taskEntries = Object.entries(asyncTasks) as [string, any][];
          const todoMap: Record<string, TodoItem[]> = {};
          // 从子线程提取标题（task_id → 标题），不受主线程消息压缩影响
          const subTitleMap: Record<string, string> = {};
          // 后端 sync 已写入的 steps_map（优先用当前值，丢失时用缓存）
          const stepsMap = values?.subagent_steps_map ?? cachedSubagentStepsMapRef.current ?? {};
          // 轮询所有任务的子线程 todos（作为步骤进度兜底）+ 标题。
          // 不按 slice 截断——否则并发任务多时靠后的任务拿不到兜底进度，
          // 若 steps_map 又因竞态缺失会显示"初始化"。最多轮询 10 个防滥用。
          // 优化：后端 sync 已将进度写入 subagent_steps_map 时，跳过子线程 getState，
          // 减少 checkpoint 读竞争和网络开销。标题从 query_headers 兜底。
          const activeTasks = taskEntries.slice(0, 10);
          await Promise.all(
            activeTasks.map(async ([taskId]) => {
              // 后端 sync 已写入此任务的步骤进度 → 跳过子线程 getState 兜底
              const hasStepsMap = stepsMap[taskId] && Array.isArray(stepsMap[taskId]) && stepsMap[taskId].length > 0;
              if (hasStepsMap) {
                // 标题从 query_headers 兜底（taskTitleMap 已有主线程提取的标题）
                const qh = values?.query_headers?.[taskId];
                if (qh?.content && !subTitleMap[taskId]) {
                  subTitleMap[taskId] = cleanTaskTitle(qh.content);
                }
                return;
              }
              try {
                const subState = await pollClient.threads.getState(taskId);
                const subValues = (subState?.values as any) || {};
                const subTodos = subValues.todos;
                const subMsgsRaw = subValues.messages || [];
                if (Array.isArray(subTodos) && subTodos.length > 0) {
                  todoMap[taskId] = subTodos;
                } else {
                  // write_todos 未调用时的兜底：从子线程消息推导步骤
                  const derived = deriveStepsFromSubMessages(subMsgsRaw);
                  if (derived.length > 0) todoMap[taskId] = derived;
                }
                // 从子线程第一条 human 消息提取【任务目标】后的标题
                const subMsgs = subValues.messages || [];
                for (const m of subMsgs) {
                  const role = m?.type || m?.role;
                  if (role !== "human" && role !== "user") continue;
                  let c = m?.content;
                  if (Array.isArray(c)) {
                    const textBlock = c.find((b) => b?.type === "text");
                    c = textBlock?.text || "";
                  }
                  const goalIdx = String(c || "").indexOf("【任务目标】");
                  if (goalIdx >= 0) {
                    const after = String(c).slice(goalIdx + "【任务目标】".length).trim();
                    const end = after.indexOf("【");
                    const title = cleanTaskTitle(end > 0 ? after.slice(0, end) : after);
                    if (title) subTitleMap[taskId] = title;
                    break;
                  }
                }
              } catch {
                // 子线程可能不可读（如刚创建），忽略
              }
            })
          );
          setPolledSubagentTodos(todoMap);
          setPolledSubagentTitles(subTitleMap);
        }
        // ── 从主线程消息提取 task_id → 标题映射 ──
        // 扫描 start_async_task 工具调用，匹配其 ToolMessage 中的 task_id，
        // 从 args.description 提取【任务目标】后的用户问题作为标题。
        const taskTitleMap: Record<string, string> = {};
        const allMessages = values?.messages || [];
        for (const msg of allMessages) {
          if (!msg || typeof msg !== "object") continue;
          const tcs = msg.tool_calls || [];
          for (const tc of tcs) {
            if (tc?.name !== "start_async_task") continue;
            const cid = tc?.id;
            const desc = tc?.args?.description || "";
            // 找对应 ToolMessage 拿 task_id
            for (const later of allMessages) {
              if (later?.tool_call_id === cid && later?.type === "tool") {
                const content = String(later.content || "");
                const m = content.match(/task_id:\s*([0-9a-f-]+)/i);
                if (m) {
                  // 提取【任务目标】后的简洁标题（清洗掉系统注入说明）
                  let title = desc;
                  const goalIdx = desc.indexOf("【任务目标】");
                  if (goalIdx >= 0) {
                    const after = desc.slice(goalIdx + "【任务目标】".length).trim();
                    const end = after.indexOf("【");
                    title = cleanTaskTitle(end > 0 ? after.slice(0, end) : after);
                  } else {
                    title = cleanTaskTitle(desc);
                  }
                  taskTitleMap[m[1]] = title;
                }
                break;
              }
            }
          }
        }
        setPolledTaskTitles(taskTitleMap);
        // 缓存：首次读取到值时保存，后续丢失时用缓存恢复
        // 检测用户发送了新消息（非 auto-continue）→ 清除缓存
        const messages = values?.messages || [];
        const lastHuman = [...messages].reverse().find(
          (m: any) => m.type === "human" || m.role === "human" || m.role === "user"
        );
        if (lastHuman) {
          const content = typeof lastHuman.content === "string" ? lastHuman.content : "";
          const isAutoContinue = content.includes("[系统自动通知]") || content.includes("子智能体查询已完成");
          if (!isAutoContinue && lastHuman.id !== lastHumanMsgIdRef.current) {
            // 新的用户消息：记录消息 id（供后续判定新查询）。
            // 不再重置全局 auto-continue 计数——并发方案按 task_id 独立追踪，
            // 每个任务完成后只 continue 一次，无需全局重置。
            lastHumanMsgIdRef.current = lastHuman.id;
          }
        }

        if (qh && !cachedQueryHeaderRef.current) {
          cachedQueryHeaderRef.current = qh;
        }
        if (ss && ss.length > 0 && !cachedSubagentStepsRef.current) {
          cachedSubagentStepsRef.current = ss;
        }
        // 优先用当前值，丢失时用缓存
        const effectiveQh = qh ?? cachedQueryHeaderRef.current;
        const effectiveSs = (ss && ss.length > 0) ? ss : cachedSubagentStepsRef.current;
        setPolledQueryHeader(effectiveQh);
        setPolledSubagentSteps(effectiveSs);
      } catch {
        // ignore
      }
      if (active) {
        timer = setTimeout(poll, busy ? 1000 : 10000);
      }
    };
    poll();
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
      setPolledTodos(null);
      setPolledQueryHeader(null);
      setPolledSubagentSteps(null);
      setPolledQueryActive(null);
      setPolledQueryHeaders(null);
      setPolledSubagentStepsMap(null);
      setPolledActiveQueries(null);
      setPolledAsyncTasks(null);
      setPolledSubagentTodos(null);
      setPolledSubagentTitles(null);
      setPolledTaskTitles(null);
      // 切换会话时清除缓存
      cachedQueryHeaderRef.current = null;
      cachedSubagentStepsRef.current = null;
      cachedQueryHeadersRef.current = null;
      cachedSubagentStepsMapRef.current = null;
      lastHumanMsgIdRef.current = null;
    };
  }, [threadId, pollClient]);

  // ── 并发多查询：按任务 auto-continue + 并发上限 ──
  // 每个完成的子任务独立触发续跑（渲染图表 + 报告）。
  // 并发上限（AUTO_CONTINUE_CAP）：同时 running 的任务达到上限时暂缓续跑，
  // 避免主智能体同时处理过多结果导致上下文爆炸。
  const AUTO_CONTINUE_CAP = 3;
  const continuedTaskIdsRef = useRef<Set<string>>(new Set()); // 已发送过 continue 的任务
  const processingRef = useRef(false); // 当前是否有续跑 run 在加载
  const prevLoadingRef = useRef(false); // 上一次 isLoading 状态（检测 run 结束）
  // 当前正在运行的主线程 run 是否为 auto-continue 续跑 run（存其任务 key）。
  // 非空 = 当前 run 是续跑 run（用户消息优先 → 可被打断）；为空 = 当前 run
  // 是用户发起的（委派/用户消息），不打断，等待其自然结束。
  const currentContinueTaskKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!threadId) return;

    const checkSubAgentDone = async () => {
      try {
        // 422 修复: assistant 未加载完成前不触发续跑(空 assistantId → HTTP 422);
        // return true 保持 1s 轮询, assistant 就绪后自动续跑
        if (!activeAssistant) return true;
        const state = await pollClient.threads.getState(threadId);
        const values = state?.values as any;
        const asyncTasks = values?.async_tasks;
        const activeQueries = values?.active_queries;
        // BUG B 修复：auto-continue 幂等。续跑通知（[系统自动通知]...check_async_task）已持久化
        // 在线程历史里；刷新后 continuedTaskIdsRef（内存态）被清空，但历史中仍留有通知——
        // 把这些任务预填进 ref 视为「已续跑过」，避免每次刷新页面都重新触发续跑 run。
        if (asyncTasks && typeof asyncTasks === "object") {
          const msgs = values?.messages;
          if (Array.isArray(msgs)) {
            for (const [tid, t] of Object.entries(asyncTasks)) {
              const tk = (t as any)?.task_id || (t as any)?.thread_id || tid;
              if (!tk || continuedTaskIdsRef.current.has(tk)) continue;
              const marker = `check_async_task("${tk}")`;
              const hasNotice = (msgs as any[]).some(
                (m) =>
                  (m?.type === "human" || m?.role === "human" || m?.role === "user") &&
                  typeof m?.content === "string" &&
                  m.content.includes("[系统自动通知]") &&
                  m.content.includes(marker)
              );
              if (hasNotice) continuedTaskIdsRef.current.add(tk);
            }
          }
        }
        // C 方案（按需轮询）：计算是否仍有待处理工作，供调度方决定下一轮间隔。
        // P1-7：cancelled/timeout/interrupted 也是终态，不计入「运行中」，
        // 否则被取消的任务会让 1s 轮询永不降频。
        const hasRunningSubtask =
          (asyncTasks && typeof asyncTasks === "object" &&
            Object.values(asyncTasks).some((t: any) => {
              const st = t?.status;
              return !TERMINAL_TASK_STATUSES.has(st);
            })) ||
          (activeQueries && typeof activeQueries === "object" &&
            Object.values(activeQueries).some((v) => v === true));
        const hasPendingTerminal =
          asyncTasks && typeof asyncTasks === "object"
            ? Object.entries(asyncTasks).some(([, t]: [string, any]) => {
                const st = t?.status;
                return (
                  AUTO_CONTINUE_STATUSES.has(st) &&
                  !continuedTaskIdsRef.current.has(t?.task_id || t?.thread_id || "")
                );
              })
            : false;
        const loopBusy =
          streamRef.current.isLoading || processingRef.current || hasRunningSubtask || hasPendingTerminal;
        if (!asyncTasks || typeof asyncTasks !== "object") return loopBusy;

        // ── 若正在处理一个续跑 run，等它结束后再处理下一个 ──
        if (processingRef.current) {
          if (prevLoadingRef.current && !streamRef.current.isLoading) {
            processingRef.current = false; // 上次续跑 run 已结束
            currentContinueTaskKeyRef.current = null;
          }
            prevLoadingRef.current = streamRef.current.isLoading;
            return loopBusy;
        }

        // ── 用户 run 进行中（isLoading 但当前不是续跑 run）→ 续跑让路 ──
        // 用户消息优先：用户主动发起的 run 期间不触发新的续跑，避免抢占/被丢弃；
        // 等主线程空闲（isLoading 复位）后再由本循环补触发。
        if (streamRef.current.isLoading && !currentContinueTaskKeyRef.current) return loopBusy;

        // 找出「最旧的终止任务」（仅 success，未 continue 过的）
        const terminalTasks = Object.entries(asyncTasks)
          .filter(([, t]: [string, any]) => {
            const st = t?.status;
            return AUTO_CONTINUE_STATUSES.has(st) && !continuedTaskIdsRef.current.has(t?.task_id || t?.thread_id || "");
          })
          .sort((a, b) => {
            const aT = a[1] as any;
            const bT = b[1] as any;
            return (aT?.created_at || "") <= (bT?.created_at || "") ? -1 : 1;
          });
        if (terminalTasks.length === 0) return loopBusy;

        // 并发上限：同时「等待续跑」的已完成任务数达到 CAP 时暂缓。
        // 这里衡量的是「已成功但还没绘制图表/报告」的任务数，而非子查询 running 数。
        // 否则并发子查询多时，第一个完成的会因其他查询仍在 running 而被无限暂缓。
        // processingRef 已保证一次只处理一个续跑 run，上限用于防止积压过多。
        const pendingContinue = terminalTasks.length;
        if (pendingContinue > AUTO_CONTINUE_CAP) return loopBusy;

        const [taskId, task] = terminalTasks[0] as [string, any];
        const taskKey = task?.task_id || task?.thread_id || taskId;

        // 并发场景下，不依赖主智能体 todos（write_todos 单一路径会被最后一个任务整体标记
        // completed，无法反映"哪些已完成任务还没绘制图表"）。auto-continue 由「未处理的
        // 已完成任务」（terminalTasks）驱动即可，processingRef 已保证一次只处理一个续跑 run。
        // 仅额外保险：主智能体正在处理时（isLoading）由 processingRef 拦住，这里不重复判断。

        // 标记已发送（先标记再 submit，防竞态重复）
        continuedTaskIdsRef.current.add(taskKey);
        processingRef.current = true;
        currentContinueTaskKeyRef.current = taskKey;
        prevLoadingRef.current = streamRef.current.isLoading;

        // 取标题（query_headers[id]）
        const qh = values?.query_headers?.[taskId];
        const title = qh?.content?.replace(/^📋\s*/, "") || taskKey.slice(0, 8);

        const rollbackContinue = () => {
          // 续跑未真正发起、被用户消息打断或提交失败：回滚标记，允许稍后重试
          continuedTaskIdsRef.current.delete(taskKey);
          processingRef.current = false;
          if (currentContinueTaskKeyRef.current === taskKey) {
            currentContinueTaskKeyRef.current = null;
          }
        };

        console.log("[useChat] 子智能体完成，自动继续任务:", taskKey.slice(0, 8), title);
        streamRef.current.submit(
          {
            messages: [
              {
                id: `auto-continue-${taskKey}-${Date.now()}`,
                type: "human",
                content:
                  `[系统自动通知] 任务 ${taskKey.slice(0, 8)}（${title}）的 nl2sql 子智能体已成功完成数据查询。` +
                  `请为该任务执行后续步骤：1) 调用 check_async_task("${taskKey}") 获取结果 ` +
                  `2) 推荐并渲染图表 3) 生成分析报告。请**不要**再次调用 start_async_task。`,
              },
            ],
          },
          {
            config: {
              ...(activeAssistant?.config ?? {}),
              recursion_limit: 500,
            },
          }
        ).catch(rollbackContinue);
        // 同步检测：submit 若被 StreamManager 的 isLoading guard 静默丢弃
        // （submit 后 isLoading 未变为 true，说明当前已有其他 run 在跑，如
        // 用户消息 run），则回滚，等主线程空闲后由本循环重试续跑。
        if (!streamRef.current.isLoading) rollbackContinue();
        return loopBusy;
      } catch {
        // ignore
      }
    };

    // C 方案（按需轮询）：有活跃 run / 运行中子任务 / 待续跑任务时 1s 检测，
    // 空闲时降为 10s，避免空转频繁 getState。
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      let busy = true;
      try {
        busy = (await checkSubAgentDone()) === true;
      } catch {
        busy = false;
      }
      if (active) {
        timer = setTimeout(poll, busy ? 1000 : 10000);
      }
    };
    poll();
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [threadId, pollClient, activeAssistant?.config]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const sendMessage = useCallback(
    async (
      content: string,
      contentBlocks: ContentBlock.Multimodal.Data[] = [],
      configurable?: Record<string, string>
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
        additional_kwargs: {
          db_name: configurable?.db_name || "aix_report",
          ...(pdfBlocks.length > 0 ? { attachments: pdfBlocks } : {}),
        },
      };

      // ── 用户消息优先：当前主线程 run 是 auto-continue 续跑 run → 中断它 ──
      // 让用户消息即时发出；被打断的续跑任务回滚其标记（continuedTaskIdsRef），
      // 由 Loop B 在主线程空闲后自动重试（已完成子任务的结果仍在 checkpoint，不丢数据）。
      if (stream.isLoading && currentContinueTaskKeyRef.current) {
        stream.stop();
        const interruptedKey = currentContinueTaskKeyRef.current;
        continuedTaskIdsRef.current.delete(interruptedKey);
        currentContinueTaskKeyRef.current = null;
        processingRef.current = false;
        prevLoadingRef.current = false;
        // 等待 isLoading 复位（stop 触发 abort，StreamManager 在 finally 中复位）
        let waited = 0;
        while (stream.isLoading && waited < 5000) {
          await new Promise((r) => setTimeout(r, 50));
          waited += 50;
        }
      }

      stream.submit(
        { messages: [newMessage] },
        {
          optimisticValues: (prev) => ({
            messages: [...(prev.messages ?? []), newMessage],

          }),
          config: {
            ...(activeAssistant?.config ?? {}),
            configurable: {
              ...(configurable ?? {}),
              // 查询关键词随 context 传给后端，注入 LLM 系统提示词，
              // 使 LLM 委派判断与前端拦截判断使用同一份关键词
              query_keywords: getQueryKeywords(),
              // 开启思考：后端 ThinkingToggleMiddleware 按此值每次模型调用重建模型
              enable_thinking: String(getEnableThinking()),
              // SQL 审批策略（P1-3）：ask=写/DDL/全表拉取弹审批卡；never=全放行
              sql_approval_policy: getSqlApprovalPolicy(),
            },
            recursion_limit: 500,
          },
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
          recursion_limit: 500,
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

  // ── 查询进行中信号的基础数据 ──
  const effectiveSubagentSteps =
    polledSubagentSteps ?? stream.values.subagent_steps ?? null;

  // 从主 todos 里按 content 匹配某查询的「图表」或「报告」条目。
  // 主 todos 无 task_id，只能靠 content 匹配。策略：
  // 从 todos 的"渲染X图表"/"生成X报告"里提取 X（描述片段），
  // 再检查该片段是否与查询标题有共同子串（双向包含或共同词）。
  const matchChartReport = useCallback(
    (todos: TodoItem[], title: string, suffix: "图表" | "报告"): TodoItem | null => {
      if (!title) return null;
      // 标题去动词前缀，提取核心描述
      const titleClean = title
        .replace(/^查询/, "").replace(/^统计/, "").replace(/^计算/, "")
        .replace(/^找出/, "").replace(/^列出/, "").replace(/^显示/, "")
        .replace(/[。？?！!]$/, "").trim();
      if (!titleClean) return null;
      // 提取标题中的核心关键词（取最长连续中文/字母数字片段，长度>=2）
      const keywords = (titleClean.match(/[一-龥A-Za-z0-9]+/g) || [])
        .filter((k) => k.length >= 2)
        .sort((a, b) => b.length - a.length);
      if (keywords.length === 0) return null;

      for (const t of todos) {
        const content = t.content || "";
        // 该条目必须是"渲染X图表"或"生成X报告"
        if (suffix === "图表" && !(content.includes("渲染") && content.includes("图表"))) continue;
        if (suffix === "报告" && !(content.includes("生成") && content.includes("报告"))) continue;
        // 从 todos 提取描述片段：去"渲染/生成/图表/报告"前后缀
        const desc = content
          .replace(/^渲染/, "").replace(/^生成/, "")
          .replace(/图表$/, "").replace(/报告$/, "").trim();
        if (!desc) continue;
        // 双向匹配：标题关键词在 desc 里，或 desc 片段在标题里
        for (const kw of keywords) {
          if (desc.includes(kw) || title.includes(desc.slice(0, Math.max(4, desc.length)))) {
            return t;
          }
        }
      }
      return null;
    },
    []
  );

  // 生成占位的图表/报告步骤（主 todos 匹配不到时）。
  // 进行中任务显示"待处理"占位，让用户看到图表/报告阶段；
  // 已完成任务显示"已完成"占位（若 content 匹配失败）。
  const placeholderChartReport = useCallback(
    (taskId: string, title: string, suffix: "图表" | "报告", status?: string): TodoItem | null => {
      if (!title) return null;
      const clean = title
        .replace(/^查询/, "").replace(/^统计/, "").replace(/^计算/, "").trim();
      if (!clean) return null;
      const prefix = suffix === "图表" ? "渲染" : "生成";
      const content = `${prefix} ${clean.slice(0, 20)}${suffix}`;
      const stepStatus = status === "success" ? "completed" : "pending";
      // id 用 task_id 稳定（避免每次渲染生成新 id 导致闪烁）
      return { id: `__placeholder_${suffix}_${taskId.slice(0, 8)}`, content, status: stepStatus as any };
    },
    []
  );

  // ── 并发多查询：派生 queryTasks 列表 ──
  // 标题从主线程消息提取（taskTitleMap，可靠关联 task_id → 问题）；
  // 进度从子线程 todos 读取（polledSubagentTodos，按 task_id 隔离）。
  // keyed 字段（query_headers / subagent_steps_map）仅作补充回退。
  const effectiveQueryHeaders =
    polledQueryHeaders ?? cachedQueryHeadersRef.current ?? {};
  const effectiveStepsMap =
    polledSubagentStepsMap ?? cachedSubagentStepsMapRef.current ?? {};

  const queryTasks: QueryTask[] = useMemo(() => {
    const at = polledAsyncTasks;
    if (at && typeof at === "object" && Object.keys(at).length > 0) {
      const tasks: QueryTask[] = Object.entries(at).map(([id, t]: [string, any]) => {
        const taskId = t?.task_id || t?.thread_id || id;
        // 标题优先级：子线程提取（最可靠，不受主线程消息压缩影响）→ 主线程消息 →
        // keyed query_headers → task_id 兜底。最终统一 cleanTaskTitle 清洗，
        // 防止 query_headers 回退来源的标题仍含系统注入说明。
        const title = cleanTaskTitle(
          polledSubagentTitles?.[id] ||
            polledSubagentTitles?.[taskId] ||
            polledTaskTitles?.[id] ||
            polledTaskTitles?.[taskId] ||
            effectiveQueryHeaders[id]?.content?.replace(/^📋\s*/, "") ||
            effectiveQueryHeaders[taskId]?.content?.replace(/^📋\s*/, "") ||
            taskId.slice(0, 8)
        );
        // 进度：以子线程 todos 为基础（稳定，不闪烁），
        // 用 keyed steps_map 的 content（含耗时）增强对应步骤。
        // steps_map 可能因竞态缺失，但子线程 todos 始终可读，避免"反复初始化"。
        const subTodos = polledSubagentTodos?.[id] || polledSubagentTodos?.[taskId] || [];
        const mapSteps = effectiveStepsMap[id] || effectiveStepsMap[taskId] || [];
        let steps: TodoItem[];
        if (subTodos.length > 0 && mapSteps.length > 0) {
          // 合并：以子线程 todos 为骨架，用 steps_map 的 content（含耗时）覆盖
          steps = subTodos.map((st) => {
            const enriched = mapSteps.find((ms) =>
              (ms.content || "").includes((st.content || "").split("(")[0].trim())
            );
            return enriched ? { ...st, content: enriched.content } : st;
          });
        } else {
          steps = subTodos.length > 0 ? subTodos : mapSteps;
        }
        // 图表/报告阶段：优先从主 todos 按 content 匹配（已完成任务有真实条目）；
        // 匹配不到时生成占位步骤（进行中显示待处理，让用户看到图表/报告阶段）。
        // 活跃续跑任务（currentContinueTaskKeyRef 命中）用 findReportTodo 直接匹配
        // 「图表」/「报告」条目拿到真实 in_progress → completed 变化——通用模板 desc
        // 与标题关键词不重合时 matchChartReport 会失败，兜底占位符把 success 当 completed
        // 导致进度从一开始就 completed、无过程；findReportTodo 只按 content 含"图表/报告"
        // 匹配主 todos 全局模板条目，不依赖标题，健壮。非活跃任务保持原逻辑（completed/pending 不串）。
        const isActiveResult = taskId === currentContinueTaskKeyRef.current;
        return {
          task_id: taskId,
          agent_name: t?.agent_name,
          title,
          // 状态以 async_tasks.status 为准（更可靠）。
          // active_queries 仅作补充：active_queries[id]===false 可把 running 纠正为
          // 实际完成状态（sync 写 false 表示任务已终止），但 active=true 不能把
          // success 误判为 running（否则已完成任务会显示为"进行中"）。
          status: (() => {
            const st = t?.status || "pending";
            if (st === "running" && polledActiveQueries?.[id] === false) {
              // 后端标记已终止但 async_tasks 仍 running（同步延迟）→ 视为 success
              return "success" as const;
            }
            return st as QueryTask["status"];
          })(),
          created_at: t?.created_at || "",
          steps,
          chartStep: isActiveResult
            ? (findReportTodo(polledTodos || [], "图表") ||
               matchChartReport(polledTodos || [], title, "图表") ||
               placeholderChartReport(taskId, title, "图表", t?.status))
            : (matchChartReport(polledTodos || [], title, "图表") ||
               placeholderChartReport(taskId, title, "图表", t?.status)),
          reportStep: isActiveResult
            ? (findReportTodo(polledTodos || [], "报告") ||
               matchChartReport(polledTodos || [], title, "报告") ||
               placeholderChartReport(taskId, title, "报告", t?.status))
            : (matchChartReport(polledTodos || [], title, "报告") ||
               placeholderChartReport(taskId, title, "报告", t?.status)),
        };
      });
      // 最新置顶（created_at 降序）
      return tasks.sort((a, b) => (a.created_at >= b.created_at ? -1 : 1));
    }
    // 回退：旧单字段模式（历史会话）
    if (polledQueryHeader || effectiveSubagentSteps?.length) {
      return [{
        task_id: "legacy",
        title: polledQueryHeader?.content?.replace(/^📋\s*/, "") || "查询",
        status: "running" as const,
        created_at: "",
        steps: effectiveSubagentSteps ?? [],
      }];
    }
    return [];
  }, [polledAsyncTasks, effectiveQueryHeaders, effectiveStepsMap, polledActiveQueries, polledQueryHeader, effectiveSubagentSteps, polledTaskTitles, polledSubagentTodos, polledSubagentTitles, polledTodos, matchChartReport, placeholderChartReport]);

  const runningQueryCount = queryTasks.filter((t) => t.status === "running").length;

  // ── 查询进行中信号 ──
  // 并发方案：running 任务数 > 0 即视为查询进行中。
  const queryInProgress = runningQueryCount > 0
    ? true
    : (polledQueryActive !== null
        ? polledQueryActive === true
        : Boolean(
            effectiveSubagentSteps &&
            effectiveSubagentSteps.some(
              (s: TodoItem) => s.status === "in_progress"
            )
          ));

  return {
    stream,
    threadId,
    todos: (polledTodos && polledTodos.length > 0)
      ? polledTodos
      : (stream.values.todos ?? []),
    queryHeader: polledQueryHeader ?? stream.values.query_header ?? null,
    subagentSteps: effectiveSubagentSteps,
    queryTasks,
    // P1-3：原始 async_tasks 轮询值（含 awaiting_approval 审批 payload），
    // 供 ChatInterface 渲染 SQL 审批卡。queryTasks 类型受限不含该字段。
    asyncTasks: polledAsyncTasks,
    runningQueryCount,
    queryInProgress,
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
    currentContinueTaskKeyRef,
    // Token 计量（来自后端 state.token_stats）
    tokenStats: stream.values.token_stats,
  };
}
// TODO  My80OmFIVnBZMlhrdUp2bG43bmx2TG82YlU1amRRPT06N2RjMGNjZmI=
