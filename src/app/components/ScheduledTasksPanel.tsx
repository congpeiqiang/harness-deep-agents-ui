"use client";

/**
 * 定时任务面板（方案 docs/NL2SQL定时任务实现方案.md §6）。
 *
 * 交互与「批量管理」同款：page.tsx 在侧栏 aside 里以 schedOpen 状态渲染本面板
 * （替代 ThreadList / SidebarRail）。功能：
 * - 列表：名称、周期（sched_display）、下次运行（本地时区）、上次结果（✓/✕/⏳ + 错误截断）；
 * - 操作：立即运行 / 暂停 / 恢复 / 编辑 / 删除 / 运行历史展开；
 * - 创建/编辑弹层：名称 + 自包含问数内容 + 数据库下拉 + 周期双模式
 *   （简单：每小时/每天/每周 + 时刻；高级：cron / 间隔 / 单次），
 *   未来 3 次运行时间实时预览走后端 /preview（cron 数学只有一份，在后端）；
 * - 运行历史：每条 = 时间 + 状态 + 「打开会话」跳 `[定时]` thread。
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleSlash,
  Clock,
  Loader2,
  Pause,
  Pencil,
  Pin,
  Play,
  Plus,
  RefreshCw,
  Trash2,
  X,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { listDatabases, type DbInfo } from "@/lib/dbConfig";
import {
  createScheduledTask,
  deleteScheduledTask,
  listScheduledRuns,
  listScheduledTasks,
  pauseScheduledTask,
  previewSchedule,
  resumeScheduledTask,
  runScheduledTaskNow,
  updateScheduledTask,
  type PreviewResult,
  type ScheduledTask,
  type TaskPayload,
  type TaskRun,
} from "@/lib/scheduledTasks";
import {
  pinScheduledTask,
  unpinScheduledTask,
  type ScheduledPin,
  type ScheduledTaskLike,
} from "@/lib/scheduledPins";

interface ScheduledTasksPanelProps {
  /** 关闭面板回到会话列表 */
  onClose?: () => void;
  /** 「打开会话」：跳到 [定时] thread（page 里 setThreadId + 关面板） */
  onOpenThread: (threadId: string) => void;
}

// ── 周期：简单模式 ↔ cron（describeSchedule 思路的前端半边，方案 §6）──

type Freq = "hourly" | "daily" | "weekly";

const WEEKDAYS = [
  { value: 1, label: "周一" },
  { value: 2, label: "周二" },
  { value: 3, label: "周三" },
  { value: 4, label: "周四" },
  { value: 5, label: "周五" },
  { value: 6, label: "周六" },
  { value: 0, label: "周日" },
];

function freqToCron(freq: Freq, minute: number, hour: number, dow: number): string {
  if (freq === "hourly") return `${minute} * * * *`;
  if (freq === "daily") return `${minute} ${hour} * * *`;
  return `${minute} ${hour} * * ${dow}`;
}

/** 能映射回简单模式的 cron → 表单预填；否则 null（编辑时落高级模式）。 */
function parseSimpleCron(
  expr: string
): { freq: Freq; minute: number; hour: number; dow: number } | null {
  const p = expr.trim().split(/\s+/);
  if (p.length !== 5 || !/^\d+$/.test(p[0])) return null;
  const minute = parseInt(p[0], 10);
  const [, hour, dom, month, dow] = p;
  if (dom !== "*" || month !== "*" || minute > 59) return null;
  if (hour === "*" && dow === "*") return { freq: "hourly", minute, hour: 9, dow: 1 };
  if (/^\d+$/.test(hour) && dow === "*" && +hour <= 23)
    return { freq: "daily", minute, hour: +hour, dow: 1 };
  if (/^\d+$/.test(hour) && /^\d+$/.test(dow) && +hour <= 23)
    return { freq: "weekly", minute, hour: +hour, dow: +dow % 7 };
  return null;
}

// ── 表单状态 ──────────────────────────────────────────────────

type SchedMode = "simple" | "advanced";
type AdvKind = "cron" | "interval" | "once";

interface FormState {
  name: string;
  prompt: string;
  dbName: string;
  mode: SchedMode;
  freq: Freq;
  /** HH:mm（daily/weekly 用） */
  timeOfDay: string;
  /** 0-6（weekly 用，0=周日，与 cron 同口径） */
  weekday: number;
  /** 每小时第几分（hourly 用） */
  hourlyMinute: number;
  kind: AdvKind;
  cronExpr: string;
  intervalMin: number;
  /** datetime-local 值（naive；后端按 Asia/Shanghai 解释，浏览器时区一致） */
  onceLocal: string;
}

function emptyForm(defaultDb: string): FormState {
  return {
    name: "",
    prompt: "",
    dbName: defaultDb,
    mode: "simple",
    freq: "daily",
    timeOfDay: "09:00",
    weekday: 1,
    hourlyMinute: 0,
    kind: "cron",
    cronExpr: "0 9 * * *",
    intervalMin: 60,
    onceLocal: "",
  };
}

function formToSchedule(f: FormState): { kind: AdvKind; expr: string } | null {
  if (f.mode === "simple") {
    if (f.freq === "hourly") {
      if (!(f.hourlyMinute >= 0 && f.hourlyMinute <= 59)) return null;
      return { kind: "cron", expr: freqToCron("hourly", f.hourlyMinute, 0, 0) };
    }
    const m = /^(\d{1,2}):(\d{2})$/.exec(f.timeOfDay.trim());
    if (!m) return null;
    const hour = +m[1];
    const minute = +m[2];
    if (hour > 23 || minute > 59) return null;
    return { kind: "cron", expr: freqToCron(f.freq, minute, hour, f.weekday) };
  }
  if (f.kind === "cron")
    return f.cronExpr.trim() ? { kind: "cron", expr: f.cronExpr.trim() } : null;
  if (f.kind === "interval")
    return f.intervalMin >= 1 ? { kind: "interval", expr: String(f.intervalMin) } : null;
  return f.onceLocal ? { kind: "once", expr: f.onceLocal } : null;
}

// ── 展示辅助 ──────────────────────────────────────────────────

const fmtLocal = (iso: string): string =>
  iso
    ? new Date(iso).toLocaleString("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";

const STATE_CHIP: Record<string, { label: string; cls: string }> = {
  scheduled: { label: "已启用", cls: "bg-green-500/15 text-green-600" },
  paused: { label: "已暂停", cls: "bg-muted text-muted-foreground" },
  completed: { label: "已完成", cls: "bg-blue-500/15 text-blue-600" },
  error: { label: "错误", cls: "bg-red-500/15 text-red-500" },
};

function StatusIcon({ status }: { status: string }) {
  if (status === "success") return <CheckCircle2 className="size-4 shrink-0 text-green-600" />;
  if (status === "error") return <XCircle className="size-4 shrink-0 text-red-500" />;
  if (status === "running") return <Loader2 className="size-4 shrink-0 animate-spin text-blue-500" />;
  if (!status) return <Clock className="size-4 shrink-0 text-muted-foreground" />;
  // interrupted / timeout / cancelled
  return <CircleSlash className="size-4 shrink-0 text-muted-foreground" />;
}

const RUN_STATUS_LABEL: Record<string, string> = {
  success: "成功",
  error: "失败",
  running: "运行中",
  timeout: "超时",
  interrupted: "已中断",
  cancelled: "已取消",
};

// ── 面板 ──────────────────────────────────────────────────────

export function ScheduledTasksPanel({ onClose, onOpenThread }: ScheduledTasksPanelProps) {
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  // 运行历史展开。runs 带 taskId 键 + expandedIdRef 守卫：慢响应返回时若已
  // 切换到别的任务，直接丢弃 —— 否则 A 的历史（含「打开会话」指向 A 的线程）
  // 会渲染进 B 的展开行。
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const expandedIdRef = useRef<string | null>(null);
  const [runs, setRuns] = useState<{ taskId: string; list: TaskRun[] } | null>(null);
  const [runsLoading, setRunsLoading] = useState(false);

  // 创建/编辑弹层
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ScheduledTask | null>(null);
  const [form, setForm] = useState<FormState>(() => emptyForm(""));
  const [saving, setSaving] = useState(false);
  const [dbs, setDbs] = useState<DbInfo[]>([]);
  const dbsLoaded = useRef(false);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewErr, setPreviewErr] = useState("");

  // 固化结果确认弹层：固化会**真跑一次查询**，跑完先把渲染后的 SQL 摆给用户
  // 看——「日期填错一天」「SQL 被改坏」都在这一步暴露，而不是等明天定时跑歪。
  const [pinConfirm, setPinConfirm] = useState<{
    taskId: string;
    taskName: string;
    pin: ScheduledPin;
  } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const out = await listScheduledTasks();
      setTasks(out.tasks || []);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // 弹层打开时拉数据库列表（一次）
  useEffect(() => {
    if (!dialogOpen || dbsLoaded.current) return;
    dbsLoaded.current = true;
    listDatabases()
      .then((list) => {
        setDbs(list);
        setForm((f) => (f.dbName ? f : { ...f, dbName: list[0]?.name || "" }));
      })
      .catch((e) => {
        dbsLoaded.current = false;
        toast.error(`加载数据库列表失败: ${e instanceof Error ? e.message : String(e)}`);
      });
  }, [dialogOpen]);

  // 周期变化 → 防抖 400ms 后端预览（未来 3 次 + 人类可读）
  const sched = formToSchedule(form);
  const schedKey = dialogOpen && sched ? `${sched.kind}|${sched.expr}` : "";
  useEffect(() => {
    if (!schedKey) {
      setPreview(null);
      setPreviewErr("");
      return;
    }
    const [kind, expr] = schedKey.split("|");
    // stale 守卫：慢的旧表达式响应不得覆盖新表达式的预览（防抖只挡未发出的
    // 请求，挡不住已在飞的 promise）
    let stale = false;
    const timer = setTimeout(() => {
      previewSchedule(kind as AdvKind, expr, "Asia/Shanghai", 3)
        .then((p) => {
          if (stale) return;
          setPreview(p);
          setPreviewErr("");
        })
        .catch((e) => {
          if (stale) return;
          setPreview(null);
          setPreviewErr(e instanceof Error ? e.message : String(e));
        });
    }, 400);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [schedKey]);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm(dbs[0]?.name || ""));
    setPreview(null);
    setDialogOpen(true);
  };

  const openEdit = (t: ScheduledTask) => {
    setEditing(t);
    const base: FormState = {
      ...emptyForm(t.db_name),
      name: t.name,
      prompt: t.prompt,
      dbName: t.db_name,
    };
    if (t.sched_kind === "cron") {
      const simple = parseSimpleCron(t.sched_expr);
      if (simple) {
        const hh = String(simple.hour).padStart(2, "0");
        const mm = String(simple.minute).padStart(2, "0");
        setForm({
          ...base,
          mode: "simple",
          freq: simple.freq,
          weekday: simple.dow,
          hourlyMinute: simple.minute,
          timeOfDay: simple.freq === "hourly" ? "09:00" : `${hh}:${mm}`,
          cronExpr: t.sched_expr,
        });
      } else {
        setForm({ ...base, mode: "advanced", kind: "cron", cronExpr: t.sched_expr });
      }
    } else if (t.sched_kind === "interval") {
      setForm({
        ...base,
        mode: "advanced",
        kind: "interval",
        intervalMin: parseInt(t.sched_expr, 10) || 60,
      });
    } else {
      setForm({ ...base, mode: "advanced", kind: "once", onceLocal: t.sched_expr.slice(0, 16) });
    }
    setPreview(null);
    setDialogOpen(true);
  };

  const act = async (id: string, fn: () => Promise<unknown>, okMsg?: string) => {
    setBusyId(id);
    try {
      await fn();
      if (okMsg) toast.success(okMsg);
      await load();
      if (expandedId === id) await showRuns(id, true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  /** 后端任务行已带 pin 字段，但 `scheduledTasks.ts` 的类型没跟上 ⇒ 结构化收窄。 */
  const pinStatusOf = (t: ScheduledTask): "" | "active" | "invalid" =>
    (t as ScheduledTaskLike).pin_status || "";

  const doPin = async (t: ScheduledTask) => {
    setBusyId(t.id);
    try {
      // 固化会真跑一次查询；成功后立刻把「渲染后的 SQL」摆给用户确认
      const out = await pinScheduledTask(t.id);
      setPinConfirm({ taskId: t.id, taskName: t.name, pin: out.pin });
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  const doUnpin = (t: ScheduledTask) => {
    if (!confirm(`取消「${t.name}」的固化查询？之后每次触发都会重新让模型写 SQL。`)) return;
    void act(t.id, () => unpinScheduledTask(t.id), "已取消固化");
  };

  const showRuns = async (id: string, force = false) => {
    if (expandedIdRef.current === id && !force) {
      expandedIdRef.current = null;
      setExpandedId(null);
      setRuns(null);
      return;
    }
    expandedIdRef.current = id;
    setExpandedId(id);
    setRunsLoading(true);
    try {
      const out = await listScheduledRuns(id, 20);
      if (expandedIdRef.current === id) setRuns({ taskId: id, list: out.runs || [] });
    } catch (e) {
      if (expandedIdRef.current === id)
        toast.error(`读取运行历史失败: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      if (expandedIdRef.current === id) setRunsLoading(false);
    }
  };

  const save = async () => {
    const s = formToSchedule(form);
    if (!form.name.trim()) return toast.error("请填写任务名");
    if (!form.prompt.trim()) return toast.error("请填写问数内容");
    if (!form.dbName) return toast.error("请选择目标数据库");
    if (!s) return toast.error("周期设置不完整");
    setSaving(true);
    try {
      const payload: TaskPayload = {
        name: form.name.trim(),
        prompt: form.prompt.trim(),
        db_name: form.dbName,
        sched_kind: s.kind,
        sched_expr: s.expr,
        tz: "Asia/Shanghai",
      };
      let task: ScheduledTask;
      if (editing) {
        // 只发有变化的字段。带调度字段的 PATCH 会触发后端 reschedule：
        // interval 任务只改个名会把 next_run_at 重锚到 now+interval（眼看要跑的
        // 一次被顺延一个整周期）；已执行完的 once 任务连改名都会被过期 expr
        // 挡成 400。纯字段 patch 走后端字段级路径，不动调度。
        const patch: Partial<TaskPayload> = {};
        if (payload.name !== editing.name) patch.name = payload.name;
        if (payload.prompt !== editing.prompt) patch.prompt = payload.prompt;
        if (payload.db_name !== editing.db_name) patch.db_name = payload.db_name;
        const tzSame = (payload.tz || "") === editing.tz;
        const schedChanged =
          payload.sched_kind !== editing.sched_kind ||
          payload.sched_expr !== editing.sched_expr ||
          !tzSame;
        // once 语义比较：datetime-local 会丢秒（"…T09:00" vs 存储 "…T09:00:00"），
        // 字符串 diff 会把它误判成「改了调度」。同一时刻 ⇒ 视为未变。
        const onceSame =
          payload.sched_kind === "once" &&
          editing.sched_kind === "once" &&
          tzSame &&
          !Number.isNaN(Date.parse(payload.sched_expr)) &&
          Date.parse(payload.sched_expr) === Date.parse(editing.sched_expr);
        if (schedChanged && !onceSame) {
          patch.sched_kind = payload.sched_kind;
          patch.sched_expr = payload.sched_expr;
          patch.tz = payload.tz;
        }
        if (Object.keys(patch).length === 0) {
          toast.info("没有需要保存的修改");
          setDialogOpen(false);
          return;
        }
        task = (await updateScheduledTask(editing.id, patch)).task;
      } else {
        task = (await createScheduledTask(payload)).task;
      }
      toast.success(
        editing ? "已保存修改" : `已创建，下次运行：${fmtLocal(task.next_run_at) || "见列表"}`
      );
      setDialogOpen(false);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  return (
    <div className="absolute inset-0 flex flex-col">
      {/* Header（ThreadList header 同款结构） */}
      <div className="flex flex-shrink-0 items-center justify-between gap-2 border-b border-border p-3">
        <div className="flex items-center gap-2">
          <CalendarClock className="size-5 text-muted-foreground" />
          <span className="text-sm font-medium">定时任务</span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="size-9 rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
            onClick={() => void load()}
            aria-label="刷新"
            title="刷新"
          >
            <RefreshCw className={cn("size-4", loading && "animate-spin")} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-9 rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
            onClick={openCreate}
            aria-label="新建定时任务"
            title="新建定时任务"
          >
            <Plus className="size-5" />
          </Button>
          {onClose && (
            <Button
              variant="ghost"
              size="icon"
              className="size-9 rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
              onClick={onClose}
              aria-label="返回会话列表"
              title="返回会话列表"
            >
              <X className="size-5" />
            </Button>
          )}
        </div>
      </div>

      {/* 列表 */}
      <ScrollArea className="flex-1">
        <div className="flex flex-col gap-2 p-3">
          {loadError && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-3 text-xs text-red-500">
              加载失败：{loadError}
              <Button variant="ghost" size="sm" className="ml-2 h-6 text-xs" onClick={() => void load()}>
                重试
              </Button>
            </div>
          )}
          {!loading && !loadError && tasks.length === 0 && (
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <CalendarClock className="size-10 text-muted-foreground/50" />
              <div className="text-sm text-muted-foreground">暂无定时任务</div>
              <div className="max-w-[220px] text-xs text-muted-foreground/70">
                创建后，后端会按周期自动发起问数，结果出现在新的「[定时]」会话里
              </div>
              <Button variant="outline" size="sm" onClick={openCreate}>
                <Plus className="mr-1 size-4" />
                创建任务
              </Button>
            </div>
          )}
          {tasks.map((t) => {
            const chip = STATE_CHIP[t.state] || STATE_CHIP.scheduled;
            const inflight = !!t.running_thread_id;
            const busy = busyId === t.id;
            const expanded = expandedId === t.id;
            return (
              <div key={t.id} className="rounded-lg border border-border bg-card p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium" title={t.name}>
                    {t.name}
                  </span>
                  {/* 固化状态：active=已固化（每次触发直接跑模板）；invalid=曾固化但已失效 */}
                  {pinStatusOf(t) === "active" && (
                    <span className="flex shrink-0 items-center gap-1 rounded-[4px] bg-emerald-500/15 px-1.5 py-0.5 text-[10px] text-emerald-600">
                      <Pin className="size-3" />
                      已固化
                    </span>
                  )}
                  {pinStatusOf(t) === "invalid" && (
                    <span
                      className="flex shrink-0 items-center gap-1 rounded-[4px] bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-600"
                      title={
                        (t as ScheduledTaskLike).pin_invalid_reason ||
                        "固化已失效，下次触发将重新由模型生成 SQL"
                      }
                    >
                      <Pin className="size-3" />
                      固化失效
                    </span>
                  )}
                  {inflight ? (
                    <span className="flex shrink-0 items-center gap-1 rounded-[4px] bg-blue-500/15 px-1.5 py-0.5 text-[10px] text-blue-500">
                      <Loader2 className="size-3 animate-spin" />
                      运行中
                    </span>
                  ) : (
                    <span
                      className={cn(
                        "shrink-0 rounded-[4px] px-1.5 py-0.5 text-[10px]",
                        chip.cls
                      )}
                    >
                      {chip.label}
                    </span>
                  )}
                </div>
                <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                  <span>{t.sched_display}</span>
                  <span className="opacity-50">·</span>
                  <span className="truncate" title={t.db_name}>
                    {t.db_name}
                  </span>
                </div>
                <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
                  <span>
                    下次：{inflight ? "—" : fmtLocal(t.next_run_at) || "—"}
                  </span>
                  {t.last_run_at && (
                    <span className="flex items-center gap-1">
                      上次：
                      <StatusIcon status={t.last_status} />
                      {fmtLocal(t.last_run_at)}
                    </span>
                  )}
                </div>
                {t.last_error && (
                  <div
                    className="mt-1 truncate text-xs text-red-500"
                    title={t.last_error}
                  >
                    {t.last_error}
                  </div>
                )}
                <div className="mt-2 flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 gap-1 px-2 text-xs"
                    disabled={busy || inflight || t.state !== "scheduled"}
                    title={t.state !== "scheduled" ? "仅「已启用」状态可立即运行" : "立即运行一次"}
                    onClick={() =>
                      void act(
                        t.id,
                        () => runScheduledTaskNow(t.id),
                        "已触发，结果将出现在新的「[定时]」会话"
                      )
                    }
                  >
                    {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
                    运行
                  </Button>
                  {t.state === "paused" ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 gap-1 px-2 text-xs"
                      disabled={busy}
                      onClick={() => void act(t.id, () => resumeScheduledTask(t.id), "已恢复")}
                    >
                      <Play className="size-3.5" />
                      恢复
                    </Button>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 gap-1 px-2 text-xs"
                      disabled={busy || t.state !== "scheduled"}
                      onClick={() => void act(t.id, () => pauseScheduledTask(t.id), "已暂停")}
                    >
                      <Pause className="size-3.5" />
                      暂停
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 gap-1 px-2 text-xs"
                    disabled={busy}
                    onClick={() => openEdit(t)}
                  >
                    <Pencil className="size-3.5" />
                    编辑
                  </Button>
                  {/* 固化：把「跑对过的那一次」存成模板，之后每次触发直接执行 */}
                  {pinStatusOf(t) === "active" ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 gap-1 px-2 text-xs"
                      disabled={busy}
                      title="取消固化后，下次触发重新由模型写 SQL"
                      onClick={() => doUnpin(t)}
                    >
                      <Pin className="size-3.5" />
                      取消固化
                    </Button>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 gap-1 px-2 text-xs"
                      disabled={busy || inflight}
                      title={
                        inflight
                          ? "运行中，等这次跑完再固化"
                          : "把最近一次成功的查询存成模板，之后按当天日期直接执行"
                      }
                      onClick={() => void doPin(t)}
                    >
                      <Pin className="size-3.5" />
                      {pinStatusOf(t) === "invalid" ? "重新固化" : "固化"}
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 gap-1 px-2 text-xs text-red-500 hover:text-red-600"
                    disabled={busy}
                    onClick={() => {
                      if (!confirm(`确定删除定时任务「${t.name}」吗？运行历史将一并删除。`)) return;
                      void act(t.id, () => deleteScheduledTask(t.id), "已删除");
                    }}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                  <div className="flex-1" />
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 gap-1 px-2 text-xs text-muted-foreground"
                    onClick={() => void showRuns(t.id)}
                  >
                    历史
                    {expanded ? (
                      <ChevronDown className="size-3.5" />
                    ) : (
                      <ChevronRight className="size-3.5" />
                    )}
                  </Button>
                </div>
                {expanded && (
                  <div className="mt-2 border-t border-border/60 pt-1">
                    {runsLoading ? (
                      <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
                        <Loader2 className="size-3.5 animate-spin" />
                        加载运行历史…
                      </div>
                    ) : !runs || runs.taskId !== t.id || runs.list.length === 0 ? (
                      <div className="py-2 text-xs text-muted-foreground">还没有运行记录</div>
                    ) : (
                      runs.list.map((r) => (
                        <div
                          key={r.id}
                          className="flex items-center gap-2 border-b border-border/40 py-1.5 text-xs last:border-b-0"
                        >
                          <StatusIcon status={r.status} />
                          <span className="shrink-0">{fmtLocal(r.fired_at)}</span>
                          <span className="shrink-0 text-muted-foreground">
                            {RUN_STATUS_LABEL[r.status] || r.status || "—"}
                          </span>
                          {r.error && (
                            <span className="truncate text-red-500" title={r.error}>
                              {r.error}
                            </span>
                          )}
                          <div className="flex-1" />
                          {r.thread_id && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 shrink-0 px-2 text-xs"
                              onClick={() => onOpenThread(r.thread_id)}
                            >
                              打开会话
                            </Button>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </ScrollArea>

      {/* 固化确认弹层：把「按今天日期渲染后的 SQL」摆给用户看再收工 */}
      <Dialog open={!!pinConfirm} onOpenChange={(o) => !o && setPinConfirm(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>固化查询已生成 —— 请确认</DialogTitle>
          </DialogHeader>
          {pinConfirm && (
            <div className="flex flex-col gap-3 text-xs">
              <div className="text-muted-foreground">
                「{pinConfirm.taskName}」之后的每次触发都会按执行当天的日期执行下面这条查询，
                不再由模型重写 SQL。请确认口径与日期范围无误。
              </div>
              {pinConfirm.pin.channel && (
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">通道</span>
                  <span className="rounded-[4px] bg-muted px-1.5 py-0.5 font-mono">
                    {pinConfirm.pin.channel === "cube"
                      ? "cube（语义层）"
                      : "sql（物理库）"}
                  </span>
                </div>
              )}
              {Object.keys(pinConfirm.pin.params || {}).length > 0 && (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="text-muted-foreground">日期锚点</span>
                  {Object.entries(pinConfirm.pin.params).map(([k, v]) => (
                    <span key={k} className="rounded-[4px] bg-muted px-1.5 py-0.5 font-mono">
                      {k} = {v}
                    </span>
                  ))}
                </div>
              )}
              {(pinConfirm.pin.warnings || []).length > 0 && (
                <ul className="list-inside list-disc rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-amber-600">
                  {pinConfirm.pin.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              )}
              <div className="flex flex-col gap-1">
                <span className="text-muted-foreground">渲染后的查询</span>
                <pre className="max-h-[40vh] overflow-auto whitespace-pre-wrap break-all rounded-md border border-border bg-muted/40 p-3 font-mono text-[11px] leading-relaxed">
                  {pinConfirm.pin.preview_sql || "（后端未返回 SQL）"}
                </pre>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPinConfirm(null)}>
              关闭
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 创建/编辑弹层 */}
      <Dialog open={dialogOpen} onOpenChange={(o) => !saving && setDialogOpen(o)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "编辑定时任务" : "新建定时任务"}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="sched-name">任务名</Label>
              <Input
                id="sched-name"
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
                placeholder="如：每日部门工时报告"
                maxLength={100}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="sched-prompt">问数内容</Label>
              <Textarea
                id="sched-prompt"
                value={form.prompt}
                onChange={(e) => set("prompt", e.target.value)}
                rows={4}
                maxLength={4000}
                placeholder="请写完整的自包含问题（定时执行时没有当前聊天上下文），如：统计上月各部门工时并生成报告"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>目标数据库</Label>
              <Select value={form.dbName} onValueChange={(v) => set("dbName", v)}>
                <SelectTrigger>
                  <SelectValue placeholder={dbs.length ? "选择数据库" : "加载中…"} />
                </SelectTrigger>
                <SelectContent>
                  {dbs.map((db) => (
                    <SelectItem key={db.name} value={db.name}>
                      {db.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>执行周期</Label>
              <div className="flex items-center gap-2">
                <div className="flex rounded-lg border border-border p-0.5">
                  {(
                    [
                      { key: "simple", label: "简单" },
                      { key: "advanced", label: "高级" },
                    ] as const
                  ).map((m) => (
                    <button
                      key={m.key}
                      type="button"
                      className={cn(
                        "rounded-md px-3 py-1 text-xs",
                        form.mode === m.key
                          ? "bg-accent font-medium text-foreground"
                          : "text-muted-foreground hover:text-foreground"
                      )}
                      onClick={() => set("mode", m.key)}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
                {form.mode === "simple" ? (
                  <Select value={form.freq} onValueChange={(v) => set("freq", v as Freq)}>
                    <SelectTrigger className="w-28">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="hourly">每小时</SelectItem>
                      <SelectItem value="daily">每天</SelectItem>
                      <SelectItem value="weekly">每周</SelectItem>
                    </SelectContent>
                  </Select>
                ) : (
                  <Select value={form.kind} onValueChange={(v) => set("kind", v as AdvKind)}>
                    <SelectTrigger className="w-28">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cron">cron 表达式</SelectItem>
                      <SelectItem value="interval">固定间隔</SelectItem>
                      <SelectItem value="once">单次</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              </div>

              {form.mode === "simple" ? (
                <div className="flex items-center gap-2">
                  {form.freq === "hourly" ? (
                    <>
                      <span className="text-xs text-muted-foreground">每小时第</span>
                      <Input
                        type="number"
                        min={0}
                        max={59}
                        className="w-20"
                        value={form.hourlyMinute}
                        onChange={(e) => set("hourlyMinute", parseInt(e.target.value, 10) || 0)}
                      />
                      <span className="text-xs text-muted-foreground">分</span>
                    </>
                  ) : (
                    <>
                      {form.freq === "weekly" && (
                        <Select
                          value={String(form.weekday)}
                          onValueChange={(v) => set("weekday", +v)}
                        >
                          <SelectTrigger className="w-24">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {WEEKDAYS.map((d) => (
                              <SelectItem key={d.value} value={String(d.value)}>
                                {d.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                      <Input
                        type="time"
                        className="w-32"
                        value={form.timeOfDay}
                        onChange={(e) => set("timeOfDay", e.target.value)}
                      />
                    </>
                  )}
                </div>
              ) : form.kind === "cron" ? (
                <Input
                  value={form.cronExpr}
                  onChange={(e) => set("cronExpr", e.target.value)}
                  placeholder="分 时 日 月 周，如：0 9 * * 1-5（工作日 09:00）"
                  className="font-mono"
                />
              ) : form.kind === "interval" ? (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">每</span>
                  <Input
                    type="number"
                    min={1}
                    className="w-24"
                    value={form.intervalMin}
                    onChange={(e) => set("intervalMin", parseInt(e.target.value, 10) || 0)}
                  />
                  <span className="text-xs text-muted-foreground">分钟执行一次</span>
                </div>
              ) : (
                <Input
                  type="datetime-local"
                  value={form.onceLocal}
                  onChange={(e) => set("onceLocal", e.target.value)}
                />
              )}
            </div>

            {/* 实时预览（后端 /preview，cron 数学只有一份） */}
            <div className="rounded-lg border border-border bg-muted/40 p-3 text-xs">
              {previewErr ? (
                <span className="text-red-500">{previewErr}</span>
              ) : preview ? (
                <div className="flex flex-col gap-1">
                  <span className="font-medium text-foreground">
                    {preview.sched_display}（Asia/Shanghai）
                  </span>
                  <span className="text-muted-foreground">
                    接下来：
                    {preview.runs.map((r) => fmtLocal(r)).join("、") || "—"}
                  </span>
                </div>
              ) : (
                <span className="text-muted-foreground">填写周期后预览下次运行时间</span>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>
              取消
            </Button>
            <Button onClick={() => void save()} disabled={saving}>
              {saving && <Loader2 className="mr-1 size-4 animate-spin" />}
              {editing ? "保存" : "创建"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
