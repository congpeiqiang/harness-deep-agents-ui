"use client";

// 待标注队列（优化③）：用户差评 → 人工判断有效性 → 修正/执行 SQL → 选错误类型 → 入 BadCase。
// 后端：GET /api/feedback/annotations* 系列（见 src/api/feedback_annotation.py）。
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  ArrowLeft,
  CheckCircle2,
  CircleDashed,
  Play,
  RefreshCw,
  ShieldCheck,
  XCircle,
  Flag,
  Database,
  MessageSquareWarning,
  ThumbsUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  fetchAnnotations,
  fetchAnnotation,
  fetchBadTypes,
  judgeAnnotation,
  executeAnnotation,
  confirmAnnotation,
  confirmGoodAnnotation,
  fetchDatasetItems,
  SOURCE_LABEL,
  Annotation,
  DatasetItem,
  AnnotationStatus,
  BadType,
  ExecResult,
} from "@/lib/feedbackLoop";

const STATUS_TABS: { key: "" | AnnotationStatus; label: string }[] = [
  { key: "", label: "全部" },
  { key: "queued", label: "待判断" },
  { key: "annotating", label: "标注中" },
  { key: "validated", label: "已验证" },
  { key: "rejected", label: "已驳回" },
  { key: "badcase", label: "BadCase" },
  { key: "good", label: "GoodCase" },
];

const STATUS_STYLE: Record<AnnotationStatus, string> = {
  queued: "bg-amber-100 text-amber-700",
  annotating: "bg-sky-100 text-sky-700",
  validated: "bg-violet-100 text-violet-700",
  rejected: "bg-slate-200 text-slate-600",
  badcase: "bg-emerald-100 text-emerald-700",
  good: "bg-teal-100 text-teal-700",
};

const STATUS_LABEL: Record<AnnotationStatus, string> = {
  queued: "待判断",
  annotating: "标注中",
  validated: "已验证",
  rejected: "已驳回",
  badcase: "BadCase",
  good: "Good",
};

function shortId(s: string): string {
  return s.length > 12 ? `${s.slice(0, 6)}…${s.slice(-6)}` : s;
}

function fmtTime(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("zh-CN", { hour12: false });
}

function ResultTable({ result }: { result: ExecResult }) {
  const rows = (result.rows ?? []).slice(0, 30);
  const cols = result.columns ?? [];
  if (cols.length === 0) {
    return <p className="text-sm text-muted-foreground">无列结果（执行成功）</p>;
  }
  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full text-left text-xs">
        <thead className="border-b border-border bg-muted">
          <tr>
            {cols.map((c) => (
              <th key={c} className="px-2 py-1.5 font-medium whitespace-nowrap">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={cols.length} className="px-2 py-4 text-center text-muted-foreground">
                0 行
              </td>
            </tr>
          ) : (
            rows.map((r, i) => (
              <tr key={i} className="border-t border-border/60">
                {cols.map((c) => (
                  <td key={c} className="max-w-[240px] truncate px-2 py-1.5">
                    {r[c] === null || r[c] === undefined ? (
                      <span className="text-muted-foreground">NULL</span>
                    ) : (
                      String(r[c])
                    )}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
      {(result.rows?.length ?? 0) > 30 && (
        <p className="border-t border-border px-2 py-1 text-[11px] text-muted-foreground">
          已显示前 30 行，共 {(result.rows ?? []).length} 行
        </p>
      )}
    </div>
  );
}

function DatasetDetail({ it, isBad }: { it: DatasetItem; isBad: boolean }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={cn(
            "rounded px-2 py-0.5 text-xs font-medium",
            isBad ? "bg-emerald-100 text-emerald-700" : "bg-teal-100 text-teal-700"
          )}
        >
          {isBad ? "BadCase" : "GoodCase"}
        </span>
        <span
          className={cn(
            "rounded px-2 py-0.5 text-xs font-medium",
            it.source === "auto-collect"
              ? "bg-sky-100 text-sky-700"
              : "bg-violet-100 text-violet-700"
          )}
        >
          来源: {(SOURCE_LABEL[it.source] ?? it.source) || "未知"}
        </span>
        {it.rating && (
          <span className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">
            {it.rating === "positive" ? "👍 好评" : "👎 差评"}
          </span>
        )}
        {it.db_name && (
          <span className="inline-flex items-center gap-1 rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">
            <Database className="size-3" />
            {it.db_name}
          </span>
        )}
        <span className="ml-auto text-xs text-muted-foreground">
          入集 {fmtTime(it.created_at)}
        </span>
      </div>
      <h2 className="mt-3 text-base font-medium">{it.question || "（未取到用户问题）"}</h2>
      {(it.bad_type || it.reasons.length > 0) && (
        <div className="mt-2 flex flex-wrap gap-1.5 text-[10px]">
          {it.bad_type && (
            <span className="rounded bg-rose-100 px-1.5 py-0.5 text-rose-700">
              错误类型: {it.bad_type}
            </span>
          )}
          {it.reasons.map((r) => (
            <span key={r} className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-700">
              {r}
            </span>
          ))}
        </div>
      )}
      {it.sql && (
        <div className="mt-3">
          <p className="text-xs text-muted-foreground">SQL</p>
          <pre className="mt-1 overflow-x-auto rounded-md bg-muted p-2 font-mono text-xs">
            {it.sql}
          </pre>
        </div>
      )}
      <div className="mt-3 flex flex-wrap gap-1.5 text-[10px] text-muted-foreground">
        <span className="font-mono">会话 {shortId(it.session_id)}</span>
        {it.trace_id && <span className="font-mono">trace {shortId(it.trace_id)}</span>}
        {it.collected_at && <span>采集日 {it.collected_at}</span>}
      </div>
    </div>
  );
}

export default function AnnotatePage() {
  const [statusTab, setStatusTab] = useState<"" | AnnotationStatus>("queued");
  const [list, setList] = useState<Annotation[]>([]);
  const [loadingList, setLoadingList] = useState(true);

  // BadCase / Good Set 模块读 Langfuse Dataset（与 Langfuse UI 一致，含来源）
  const isDatasetTab = statusTab === "badcase" || statusTab === "good";
  const [dsList, setDsList] = useState<DatasetItem[]>([]);
  const [dsSel, setDsSel] = useState<string | null>(null); // item_id

  const [selKey, setSelKey] = useState<string | null>(null); // `${tid}::${mid}`
  const [detail, setDetail] = useState<Annotation | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const [annotator, setAnnotator] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    return window.localStorage.getItem("feedback.annotator") ?? "";
  });

  // 编辑区草稿
  const [sqlDraft, setSqlDraft] = useState("");
  const [dbName, setDbName] = useState("");
  const [badType, setBadType] = useState("");
  const [goldSql, setGoldSql] = useState("");
  const [note, setNote] = useState("");
  const [execResult, setExecResult] = useState<ExecResult | null>(null);
  const [execError, setExecError] = useState("");
  const [executing, setExecuting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [confirmingGood, setConfirmingGood] = useState(false);
  const [badTypes, setBadTypes] = useState<BadType[]>([]);
  const [busyKey, setBusyKey] = useState(""); // judge 中防抖

  const refreshList = useCallback(
    async (tab: "" | AnnotationStatus) => {
      setLoadingList(true);
      try {
        const resp = await fetchAnnotations(tab, 100);
        setList(resp.annotations);
        // 自动选中第一条（当前 tab 为空时兜底到 queued）
        if (resp.annotations.length > 0) {
          const first = resp.annotations[0];
          setSelKey(`${first.thread_id}::${first.message_id}`);
        } else {
          setSelKey(null);
          setDetail(null);
        }
      } catch (e) {
        toast.error(`拉取队列失败: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        setLoadingList(false);
      }
    },
    []
  );

  const refreshDataset = useCallback(
    async (tab: "" | AnnotationStatus) => {
      const name: "badcase" | "goodcase" =
        tab === "good" ? "goodcase" : "badcase";
      setLoadingList(true);
      try {
        const resp = await fetchDatasetItems(name, 200);
        setDsList(resp.items);
        if (resp.items.length > 0) {
          setDsSel(resp.items[0].item_id);
        } else {
          setDsSel(null);
          setDetail(null);
        }
      } catch (e) {
        toast.error(`拉取 Dataset 失败: ${e instanceof Error ? e.message : String(e)}`);
        setDsList([]);
        setDsSel(null);
      } finally {
        setLoadingList(false);
      }
    },
    []
  );

  const loadDetail = useCallback(
    async (tid: string, mid: string) => {
      setLoadingDetail(true);
      setExecError("");
      try {
        const resp = await fetchAnnotation(tid, mid);
        const a = resp.annotation;
        setDetail(a);
        setSqlDraft(a.bad_sql || a.gold_sql || "");
        setDbName(a.db_name || "");
        setBadType(a.bad_type || "");
        setGoldSql(a.gold_sql || "");
        setNote(a.note || "");
        setExecResult(null);
      } catch (e) {
        toast.error(`拉取详情失败: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        setLoadingDetail(false);
      }
    },
    []
  );

  // 首次加载 bad_types + 队列
  useEffect(() => {
    fetchBadTypes().then(setBadTypes).catch(() => setBadTypes([]));
  }, []);

  useEffect(() => {
    if (isDatasetTab) refreshDataset(statusTab);
    else refreshList(statusTab);
  }, [statusTab, isDatasetTab, refreshList, refreshDataset]);

  // 选中项变化（含切 tab 后自动选第一条）→ 拉详情
  useEffect(() => {
    if (selKey) {
      const [tid, mid] = selKey.split("::");
      loadDetail(tid, mid);
    }
  }, [selKey, loadDetail]);

  const onSelect = (tid: string, mid: string) => {
    setSelKey(`${tid}::${mid}`);
  };

  const onJudge = async (isValid: boolean) => {
    if (!detail) return;
    const key = `${detail.thread_id}::${detail.message_id}`;
    setBusyKey(key);
    try {
      await judgeAnnotation(detail.thread_id, detail.message_id, isValid, annotator);
      toast.success(isValid ? "已标记为有效反馈，进入标注" : "已驳回");
      if (annotator) window.localStorage.setItem("feedback.annotator", annotator);
      await loadDetail(detail.thread_id, detail.message_id);
      refreshList(statusTab);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyKey("");
    }
  };

  // 点赞正例直达 Good Set：判断有效即一步入集（跳过修正/验证 SQL）
  const onJudgeGood = async () => {
    if (!detail) return;
    const key = `${detail.thread_id}::${detail.message_id}`;
    setBusyKey(key);
    try {
      await judgeAnnotation(detail.thread_id, detail.message_id, true, annotator, true);
      toast.success("已确认有效并直接入 Good Set");
      if (annotator) window.localStorage.setItem("feedback.annotator", annotator);
      await loadDetail(detail.thread_id, detail.message_id);
      refreshList(statusTab);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyKey("");
    }
  };

  const onExecute = async () => {
    if (!detail) return;
    if (!sqlDraft.trim()) {
      toast.error("请先填写 SQL");
      return;
    }
    setExecuting(true);
    setExecError("");
    try {
      const resp = await executeAnnotation(
        detail.thread_id,
        detail.message_id,
        sqlDraft,
        dbName
      );
      setExecResult(resp.result);
      setGoldSql(sqlDraft); // 执行通过的 SQL 预填为金标
      // 本地同步后端状态（bad_sql 已存、状态推进 validated），避免 loadDetail 重置结果表
      setDetail((prev) =>
        prev
          ? {
              ...prev,
              status: "validated",
              bad_sql: sqlDraft,
              exec_error: "",
              db_name: dbName || prev.db_name,
            }
          : prev
      );
      toast.success(`执行成功：${resp.result.row_count ?? "?"} 行`);
      refreshList(statusTab);
    } catch (e) {
      setExecResult(null);
      const msg = e instanceof Error ? e.message : String(e);
      setExecError(msg);
      toast.error(`执行失败: ${msg}`);
    } finally {
      setExecuting(false);
    }
  };

  const onConfirm = async () => {
    if (!detail) return;
    if (!goldSql.trim()) {
      toast.error("请填写金标 SQL");
      return;
    }
    if (!badType) {
      toast.error("请选择错误类型");
      return;
    }
    setConfirming(true);
    try {
      const resp = await confirmAnnotation(detail.thread_id, detail.message_id, {
        gold_sql: goldSql,
        bad_type: badType,
        note: note || undefined,
        db_name: dbName || undefined,
        annotator: annotator || undefined,
      });
      toast.success("已确认入 BadCase（写入 Dataset + 回归集）");
      setDetail(resp.annotation);
      refreshList(statusTab);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setConfirming(false);
    }
  };

  const onConfirmGood = async () => {
    if (!detail) return;
    if (!sqlDraft.trim() && !detail.bad_sql && !detail.gold_sql) {
      toast.error("缺少正确 SQL（请先填写/执行验证模型 SQL）");
      return;
    }
    setConfirmingGood(true);
    try {
      const resp = await confirmGoodAnnotation(detail.thread_id, detail.message_id, {
        sql: sqlDraft.trim() || detail.gold_sql || detail.bad_sql || undefined,
        db_name: dbName || undefined,
        annotator: annotator || undefined,
      });
      toast.success("已确认入 Good Set（写入 Dataset:goodcase）");
      setDetail(resp.annotation);
      refreshList(statusTab);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setConfirmingGood(false);
    }
  };

  const status = detail?.status ?? "queued";
  const selectedId = detail ? `${detail.thread_id}::${detail.message_id}` : null;
  const isTerminal =
    status === "rejected" || status === "badcase" || status === "good";

  return (
    <div className="flex h-screen flex-col bg-background">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-border px-6">
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
            返回聊天
          </Link>
          <span className="text-muted-foreground">/</span>
          <h1 className="flex items-center gap-2 text-lg font-semibold">
            <MessageSquareWarning className="size-5" />
            待标注队列
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              isDatasetTab ? refreshDataset(statusTab) : refreshList(statusTab)
            }
            disabled={loadingList}
          >
            <RefreshCw className={cn("mr-1.5 size-3.5", loadingList && "animate-spin")} />
            刷新
          </Button>
          <Input
            className="h-8 w-40"
            placeholder="标注人（可选）"
            value={annotator}
            onChange={(e) => setAnnotator(e.target.value)}
            onBlur={() => {
              if (annotator) window.localStorage.setItem("feedback.annotator", annotator);
            }}
          />
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* 左：状态 Tab + 队列 */}
        <aside className="flex w-80 shrink-0 flex-col border-r border-border">
          <div className="flex flex-wrap gap-1 border-b border-border p-2">
            {STATUS_TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setStatusTab(t.key)}
                className={cn(
                  "rounded-md px-2.5 py-1 text-xs transition-colors",
                  statusTab === t.key
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:bg-accent"
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {loadingList ? (
              <p className="p-3 text-sm text-muted-foreground">加载中…</p>
            ) : isDatasetTab ? (
              dsList.length === 0 ? (
                <p className="p-3 text-sm text-muted-foreground">
                  该 Dataset 暂无记录（与 Langfuse UI 一致）
                </p>
              ) : (
                dsList.map((it) => {
                  const active = dsSel === it.item_id;
                  const isBad = statusTab === "badcase";
                  return (
                    <button
                      key={it.item_id}
                      onClick={() => setDsSel(it.item_id)}
                      className={cn(
                        "mb-1 w-full rounded-md border p-2.5 text-left transition-colors",
                        active
                          ? "border-foreground/40 bg-accent"
                          : "border-border hover:bg-accent/50"
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span
                          className={cn(
                            "rounded px-1.5 py-0.5 text-[10px] font-medium",
                            isBad
                              ? "bg-emerald-100 text-emerald-700"
                              : "bg-teal-100 text-teal-700"
                          )}
                        >
                          {isBad ? "BadCase" : "Good"}
                        </span>
                        <span
                          className={cn(
                            "rounded px-1.5 py-0.5 text-[10px] font-medium",
                            it.source === "auto-collect"
                              ? "bg-sky-100 text-sky-700"
                              : "bg-violet-100 text-violet-700"
                          )}
                          title={`来源: ${it.source}`}
                        >
                          {(SOURCE_LABEL[it.source] ?? it.source) || "未知"}
                        </span>
                      </div>
                      <p className="mt-1 line-clamp-2 text-xs leading-snug">
                        {it.question || "(无问题)"}
                      </p>
                      {it.db_name && (
                        <p className="mt-1 text-[10px] text-muted-foreground">
                          {it.db_name}
                        </p>
                      )}
                      <div className="mt-1.5 flex items-center justify-between text-[10px] text-muted-foreground">
                        <span>
                          {it.bad_type
                            ? `错误: ${it.bad_type}`
                            : it.reasons.length > 0
                              ? `降分: ${it.reasons.length}`
                              : ""}
                        </span>
                        <span className="truncate pl-2">{shortId(it.session_id)}</span>
                      </div>
                    </button>
                  );
                })
              )
            ) : list.length === 0 ? (
              <p className="p-3 text-sm text-muted-foreground">该状态暂无记录</p>
            ) : (
              list.map((a) => {
                const key = `${a.thread_id}::${a.message_id}`;
                return (
                  <button
                    key={key}
                    onClick={() => onSelect(a.thread_id, a.message_id)}
                    className={cn(
                      "mb-1 w-full rounded-md border p-2.5 text-left transition-colors",
                      selectedId === key
                        ? "border-foreground/40 bg-accent"
                        : "border-border hover:bg-accent/50"
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={cn(
                          "rounded px-1.5 py-0.5 text-[10px] font-medium",
                          STATUS_STYLE[a.status]
                        )}
                      >
                        {STATUS_LABEL[a.status]}
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        {a.feedback_type || "未判定"}
                      </span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs leading-snug">
                      {a.question || a.bad_sql || "(无问题摘要)"}
                    </p>
                    <div className="mt-1.5 flex items-center justify-between text-[10px] text-muted-foreground">
                      <span>{a.rating === "positive" ? "👍" : "👎"}</span>
                      <span className="truncate pl-2">
                        {shortId(a.thread_id)}/{shortId(a.message_id)}
                      </span>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </aside>

        {/* 右：详情 + 操作 */}
        <main className="min-w-0 flex-1 overflow-y-auto p-6">
          {isDatasetTab ? (
            dsSel ? (
              <div className="mx-auto max-w-3xl space-y-5">
                <DatasetDetail
                  it={dsList.find((i) => i.item_id === dsSel)!}
                  isBad={statusTab === "badcase"}
                />
                <p className="text-[11px] text-muted-foreground">
                  BadCase / Good Set 模块与 Langfuse UI 的 Dataset:badcase / Dataset:goodcase
                  保持一致（含来源）。数据来自 Langfuse，非本地标注队列。
                </p>
              </div>
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                该 Dataset 暂无记录
              </div>
            )
          ) : !detail ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              从左侧选择一条记录开始标注
            </div>
          ) : (
            <div className="mx-auto max-w-3xl space-y-5">
              {/* 概览 */}
              <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={cn(
                      "rounded px-2 py-0.5 text-xs font-medium",
                      STATUS_STYLE[status]
                    )}
                  >
                    {STATUS_LABEL[status]}
                  </span>
                  <span className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                    {detail.feedback_type || "未判定"}
                  </span>
                  <span className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                    {detail.rating === "positive" ? "👍 好评" : "👎 差评"}
                  </span>
                  {detail.db_name && (
                    <span className="inline-flex items-center gap-1 rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                      <Database className="size-3" />
                      {detail.db_name}
                    </span>
                  )}
                  <span className="ml-auto text-xs text-muted-foreground">
                    创建 {fmtTime(detail.created_at)}
                  </span>
                </div>
                <h2 className="mt-3 text-base font-medium">
                  {detail.question || "（未取到用户问题）"}
                </h2>
                {detail.note && (
                  <p className="mt-1 text-sm text-muted-foreground">
                    用户备注：{detail.note}
                  </p>
                )}
                <div className="mt-3 flex flex-wrap gap-1.5 text-[10px] text-muted-foreground">
                  <span className="font-mono">
                    会话 {shortId(detail.thread_id)}
                  </span>
                  <span className="font-mono">
                    消息 {shortId(detail.message_id)}
                  </span>
                  {detail.annotator && <span>标注人：{detail.annotator}</span>}
                </div>
              </div>

              {/* 判断（queued） */}
              {status === "queued" && (
                <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
                  <p className="text-sm font-medium">人工判断</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    这条反馈是否有效？（点赞（含无评论）→ 直接入 Good Set；差评/需核对 → 进入标注；闲聊/误点 → 驳回）
                  </p>
                  <div className="mt-3 flex gap-2">
                    {detail.rating === "positive" && (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={onJudgeGood}
                        disabled={busyKey === selectedId}
                        title="点赞反馈判断有效后直接写入 Dataset:goodcase，无需再修正/验证 SQL"
                      >
                        <ThumbsUp className="mr-1.5 size-4" />
                        有效查询，直接入 Good Set
                      </Button>
                    )}
                    <Button
                      size="sm"
                      onClick={() => onJudge(true)}
                      disabled={busyKey === selectedId}
                    >
                      <CheckCircle2 className="mr-1.5 size-4" />
                      有效反馈，进入标注
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => onJudge(false)}
                      disabled={busyKey === selectedId}
                    >
                      <XCircle className="mr-1.5 size-4 text-rose-500" />
                      无效 / 误报，驳回
                    </Button>
                  </div>
                </div>
              )}

              {/* 标注（annotating / validated） */}
              {!isTerminal && status !== "queued" && (
                <>
                  <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
                    <p className="text-sm font-medium">修正并验证 SQL</p>
                    <div className="mt-2 flex items-center gap-2">
                      <Textarea
                        value={sqlDraft}
                        onChange={(e) => setSqlDraft(e.target.value)}
                        placeholder="SELECT …（只读，写/DDL 会被后端拒绝）"
                        rows={5}
                        className="font-mono text-xs"
                      />
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <Input
                        className="h-8 w-48 text-xs"
                        placeholder="数据库名（默认用反馈带的）"
                        value={dbName}
                        onChange={(e) => setDbName(e.target.value)}
                      />
                      <Button size="sm" onClick={onExecute} disabled={executing}>
                        <Play className="mr-1.5 size-4" />
                        {executing ? "执行中…" : "执行验证"}
                      </Button>
                      {status === "validated" && (
                        <span className="inline-flex items-center gap-1 text-xs text-emerald-600">
                          <ShieldCheck className="size-3.5" />
                          已验证可执行
                        </span>
                      )}
                    </div>
                    {execError && (
                      <p className="mt-2 rounded-md border border-rose-200 bg-rose-50 px-2 py-1.5 text-xs text-rose-600">
                        {execError}
                      </p>
                    )}
                    {execResult && (
                      <div className="mt-3">
                        <ResultTable result={execResult} />
                      </div>
                    )}
                  </div>

                  {/* 确认入 Good Set（正向样本，点赞/正确查询的出口） */}
                  <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
                    <p className="flex items-center gap-2 text-sm font-medium text-teal-700">
                      <ThumbsUp className="size-4" />
                      确认入 Good Set（正向样本）
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      查询正确、可作正例回归的反馈走这里。SQL 取上方已填/执行验证通过的模型
                      SQL，写入 Langfuse Dataset:goodcase。
                    </p>
                    <div className="mt-3 flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={onConfirmGood}
                        disabled={confirmingGood}
                      >
                        <ThumbsUp className="mr-1.5 size-4" />
                        {confirmingGood ? "确认中…" : "确认入 Good Set"}
                      </Button>
                      {detail.rating === "positive" ? (
                        <span className="text-[11px] text-teal-600">
                          点赞反馈建议直接走这里（BadCase 仅差评可用）
                        </span>
                      ) : (
                        <span className="text-[11px] text-muted-foreground">
                          写入 Langfuse Dataset:goodcase（本地终态 good）
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
                    <p className="text-sm font-medium">确认入 BadCase</p>
                    <div className="mt-2 grid gap-3">
                      <div>
                        <label className="mb-1 block text-xs text-muted-foreground">
                          错误类型
                        </label>
                        <Select value={badType} onValueChange={setBadType}>
                          <SelectTrigger className="h-8 w-64 text-xs">
                            <SelectValue placeholder="选择错误类型" />
                          </SelectTrigger>
                          <SelectContent>
                            {badTypes.map((b) => (
                              <SelectItem key={b.key} value={b.key} className="text-xs">
                                {b.label}（{b.key}）
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {badType && (
                          <p className="mt-1 text-[11px] text-muted-foreground">
                            {badTypes.find((b) => b.key === badType)?.desc}
                          </p>
                        )}
                      </div>
                      <div>
                        <label className="mb-1 block text-xs text-muted-foreground">
                          金标 SQL（正确写法，必须可执行通过）
                        </label>
                        <Textarea
                          value={goldSql}
                          onChange={(e) => setGoldSql(e.target.value)}
                          rows={4}
                          className="font-mono text-xs"
                          placeholder="SELECT …"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs text-muted-foreground">
                          备注（可选，进回归集）
                        </label>
                        <Textarea
                          value={note}
                          onChange={(e) => setNote(e.target.value)}
                          rows={2}
                          className="text-xs"
                          placeholder="例如：JOIN 条件写错导致关联结果翻倍"
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="default"
                          onClick={onConfirm}
                          disabled={
                            confirming ||
                            !goldSql.trim() ||
                            !badType ||
                            detail.rating === "positive"
                          }
                          title={
                            detail.rating === "positive"
                              ? "点赞反馈不能入 BadCase"
                              : undefined
                          }
                        >
                          <Flag className="mr-1.5 size-4" />
                          {confirming ? "确认中…" : "确定入 BadCase"}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => onJudge(false)}
                          disabled={busyKey === selectedId}
                        >
                          <XCircle className="mr-1.5 size-4 text-rose-500" />
                          驳回此条
                        </Button>
                        {detail.rating === "positive" ? (
                          <span className="text-[11px] text-amber-600">
                            点赞反馈仅差评可入 BadCase；请用上方「确认入 Good Set」或「驳回此条」
                          </span>
                        ) : (
                          <span className="text-[11px] text-muted-foreground">
                            写入 Langfuse Dataset + 回归集（badcase_status=reviewed）
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </>
              )}

              {/* 终态展示 */}
              {isTerminal && (
                <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
                  {status === "badcase" ? (
                    <>
                      <p className="flex items-center gap-2 text-sm font-medium text-emerald-600">
                        <CircleDashed className="size-4" />
                        已入 BadCase
                      </p>
                      <div className="mt-2 grid grid-cols-2 gap-3 text-xs">
                        <div>
                          <p className="text-muted-foreground">错误类型</p>
                          <p className="mt-0.5">
                            {detail.bad_type || "—"}
                            {detail.bad_type &&
                              `（${
                                badTypes.find((b) => b.key === detail.bad_type)?.label ?? ""
                              }）`}
                          </p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">确认时间</p>
                          <p className="mt-0.5">{fmtTime(detail.badcase_at)}</p>
                        </div>
                        <div className="col-span-2">
                          <p className="text-muted-foreground">金标 SQL</p>
                          <pre className="mt-1 overflow-x-auto rounded-md bg-muted p-2 font-mono text-xs">
                            {detail.gold_sql || "—"}
                          </pre>
                        </div>
                        {detail.gold_result && (
                          <div className="col-span-2">
                            <p className="text-muted-foreground">金标结果（预览 JSON）</p>
                            <pre className="mt-1 max-h-40 overflow-auto rounded-md bg-muted p-2 font-mono text-[11px]">
                              {detail.gold_result.slice(0, 2000)}
                              {detail.gold_result.length > 2000 ? " …" : ""}
                            </pre>
                          </div>
                        )}
                      </div>
                    </>
                  ) : status === "good" ? (
                    <>
                      <p className="flex items-center gap-2 text-sm font-medium text-teal-600">
                        <CircleDashed className="size-4" />
                        已入 Good Set（正向样本）
                      </p>
                      <div className="mt-2 grid grid-cols-2 gap-3 text-xs">
                        <div>
                          <p className="text-muted-foreground">确认时间</p>
                          <p className="mt-0.5">{fmtTime(detail.badcase_at)}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">类型</p>
                          <p className="mt-0.5">{detail.feedback_type || "未判定"}</p>
                        </div>
                        <div className="col-span-2">
                          <p className="text-muted-foreground">正确 SQL</p>
                          <pre className="mt-1 overflow-x-auto rounded-md bg-muted p-2 font-mono text-xs">
                            {detail.gold_sql || "—"}
                          </pre>
                        </div>
                      </div>
                    </>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      已驳回（无效 / 误报 / 闲聊）。如误操作需恢复，请删除对应反馈后重新入队。
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
