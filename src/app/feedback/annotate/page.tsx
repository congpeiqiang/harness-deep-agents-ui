"use client";

// 待标注队列（优化③）：用户差评 → 人工判断有效性 → 修正/执行 SQL → 选错误类型 → 入 BadCase。
// 后端：GET /api/feedback/annotations* 系列（见 src/api/feedback_annotation.py）。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  ArrowLeft,
  Boxes,
  CheckCircle2,
  CircleDashed,
  Loader2,
  Play,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  XCircle,
  Flag,
  Database,
  MessageSquareWarning,
  ThumbsUp,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import {
  fetchAnnotations,
  fetchAnnotation,
  fetchBadTypes,
  judgeAnnotation,
  executeAnnotation,
  previewCubeAnnotation,
  confirmAnnotation,
  confirmGoodAnnotation,
  fetchDatasetItems,
  fetchDatasetStats,
  revokeGoodAnnotation,
  deleteAnnotation,
  clearAnnotations,
  ANNOTATION_DELETABLE,
  SOURCE_LABEL,
  Annotation,
  DatasetItem,
  DatasetStatsResponse,
  AnnotationStatus,
  BadType,
  ExecResult,
  CubePreviewResponse,
} from "@/lib/feedbackLoop";

// 可删状态的白名单（与后端 store.ANNOTATION_DELETABLE 同源，此处按 string 比较：
// statusTab 可能是 `""`（全部）——它不在名单里，这正是我们要的，「全部」Tab 不能有
// 清空按钮，也不能给 good/badcase 行渲染删除键）。
const DELETABLE_KEYS: readonly string[] = ANNOTATION_DELETABLE;
const isDeletable = (s: string): boolean => DELETABLE_KEYS.includes(s);

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

/** Cube 聚合口径（cube_spec JSON 串）→ 可读行。
 *
 * 后端 2026-09-19 起把 Cube 通道的规范化查询定义随条目带出（measures/dimensions/
 * filters…）。它是「同题多跑是否用了同一套聚合口径」的最直接信号，比读物理 SQL
 * 快得多。空串 / 解析失败 / 老条目 ⇒ 什么都不渲染（该条目不是 Cube 通道）。
 */
function CubeSpecBlock({ spec }: { spec: string }) {
  const lines = useMemo(() => {
    if (!spec) return [] as [string, string][];
    try {
      const obj = JSON.parse(spec) as Record<string, unknown>;
      if (!obj || typeof obj !== "object") return [] as [string, string][];
      return Object.entries(obj).map(
        ([k, v]) =>
          [k, typeof v === "string" ? v : JSON.stringify(v)] as [string, string]
      );
    } catch {
      return [] as [string, string][];
    }
  }, [spec]);
  if (lines.length === 0) return null;
  return (
    <div className="mt-3">
      <p className="text-xs text-muted-foreground">
        Cube 聚合口径（wren 语义层，监控/评测按它比对同题多跑是否一致）
      </p>
      <div className="mt-1 rounded-md bg-muted p-2 font-mono text-xs">
        {lines.map(([k, v]) => (
          <div key={k} className="break-all">
            <span className="text-muted-foreground">{k}: </span>
            {v}
          </div>
        ))}
      </div>
    </div>
  );
}

function DatasetDetail({
  it,
  isBad,
  onRevoke,
  revoking,
  revocable,
}: {
  it: DatasetItem;
  isBad: boolean;
  onRevoke?: () => void;
  revoking?: boolean;
  /** 能否撤回：需要该条在本地能找到对应的标注行（见页面里的 midFor）。 */
  revocable?: boolean;
}) {
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
      {/* 模型实际下发的 SQL：与上方金标逐字相同时不重复渲染（人工条常见），
          只在「模型跑的 ≠ 人工认定的」或「自动采集无金标」时才有新信息。 */}
      {it.physical_sql_original && it.physical_sql_original !== it.sql && (
        <div className="mt-3">
          <p className="text-xs text-muted-foreground">
            模型实际下发的 SQL（{it.sql ? "与上方金标不同" : "本条无金标"}）
          </p>
          <pre className="mt-1 overflow-x-auto rounded-md bg-muted p-2 font-mono text-xs">
            {it.physical_sql_original}
          </pre>
        </div>
      )}
      <CubeSpecBlock spec={it.cube_spec} />
      {it.note && (
        <div className="mt-3">
          <p className="text-xs text-muted-foreground">用户评论</p>
          <p className="mt-1 whitespace-pre-wrap rounded-md bg-muted p-2 text-xs">
            {it.note}
          </p>
        </div>
      )}
      <div className="mt-3 flex flex-wrap gap-1.5 text-[10px] text-muted-foreground">
        <span className="font-mono">会话 {shortId(it.session_id)}</span>
        {it.trace_id && <span className="font-mono">trace {shortId(it.trace_id)}</span>}
        {it.collected_at && <span>采集日 {it.collected_at}</span>}
      </div>
      {/* 撤回入集：只对 GoodCase，且**真删** Langfuse 数据集条目（不是打标记——
          数据集是评测基准，留一条错标就是毒化）。自动入集的门槛是宽松的（只看点赞
          + 有 SQL + 非闲聊），所以这条退路必须存在且好找。 */}
      {!isBad && onRevoke && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
          <Button
            variant="outline"
            size="sm"
            onClick={onRevoke}
            disabled={!revocable || revoking}
            title={
              revocable
                ? "删除 Langfuse 里这条 Dataset item，本地条目回到「待判断」"
                : "该条目入集时没记消息 id，且本会话下找不到唯一对应的本地标注，无法安全定位——请到 Langfuse 数据集 UI 手动删除"
            }
          >
            <Trash2 className="mr-1.5 size-3.5" />
            {revoking ? "撤回中…" : "撤回（移出 Good Set）"}
          </Button>
          <span className="text-[11px] text-muted-foreground">
            {revocable
              ? "真删数据集条目，本地回到「待判断」"
              : "定位不到对应标注（老条目），请在 Langfuse UI 手动删除"}
          </span>
        </div>
      )}
    </div>
  );
}

/** 头部统计条：队列深度 + 两个数据集的规模与**金标缺口**。
 *
 *  为什么要把缺口顶到页面上：`badcase` 里 `expected_output=None` 的条目只能回答
 *  「还跑不跑得通」，回答不了「这次答对了没」——下游评测读的是 expected_output
 *  （字段契约：机器读的唯一权威）。缺口看不见，就没人去补，坏例集永远停在半成品。
 */
function StatsStrip({
  stats,
  onTab,
}: {
  stats: DatasetStatsResponse | null;
  onTab: (t: "" | AnnotationStatus) => void;
}) {
  if (!stats) return null;
  const q = stats.queue ?? ({} as Record<AnnotationStatus, number>);
  const bad = stats.badcase;
  const good = stats.goodcase;
  const autoGood = good?.by_source?.["auto-good"] ?? 0;
  // Langfuse 没接的时候两个数据集回零——那不是「真的 0 条」，显示成「—」而不是 0，
  // 免得有人对着 0 去补金标。
  const off = Boolean(stats.disabled || stats.error);
  const cells: {
    key: string;
    label: string;
    value: string;
    hint: string;
    tab: "" | AnnotationStatus;
  }[] = [
    {
      key: "queued",
      label: "待判断",
      value: String(q.queued ?? 0),
      hint: "本地队列：用户反馈了但还没人判断过",
      tab: "queued",
    },
    {
      key: "annotating",
      label: "标注中",
      value: String(q.annotating ?? 0),
      hint: "本地队列：已判有效，正在补 SQL / 金标",
      tab: "annotating",
    },
    {
      key: "bad",
      label: "BadCase 待补金标",
      value: off ? "—" : `${bad?.without_gold ?? 0}/${bad?.total ?? 0}`,
      hint:
        "分母是 Langfuse badcase 全量；分子是没有 expected_output.sql 的（只能验证跑不跑得通，验证不了答对没）" +
        (stats.disabled ? "；Langfuse 未接入" : stats.error ? `；读失败：${stats.error}` : ""),
      tab: "badcase",
    },
    {
      key: "good",
      label: "GoodCase",
      value: off
        ? "—"
        : `${good?.total ?? 0}${autoGood > 0 ? `（自动 ${autoGood}）` : ""}`,
      hint: "正样本总量；括号内是「点赞自动入集」写入的（门槛宽松，复核优先看这批）",
      tab: "good",
    },
  ];
  return (
    <div className="mr-1 hidden items-center gap-0.5 text-[11px] text-muted-foreground lg:flex">
      {cells.map((c) => (
        <button
          key={c.key}
          type="button"
          onClick={() => onTab(c.tab)}
          title={c.hint}
          className="rounded px-1.5 py-0.5 whitespace-nowrap transition-colors hover:bg-accent"
        >
          {c.label}{" "}
          <span className="font-medium text-foreground">{c.value}</span>
        </button>
      ))}
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

  // 头部统计条（队列深度 + 数据集规模 + 金标缺口）
  const [stats, setStats] = useState<DatasetStatsResponse | null>(null);
  const [revoking, setRevoking] = useState(false);

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
  // Cube 口径试算（仅 Cube 通道条目可见）：草稿 + 结果 + 报错，与 SQL 侧那套并列。
  // cubeSpecOrigin = **模型那次实际用的口径**（后端经 cube_original 回显的不可变
  // 快照那份），「重置」按它还原；不能拿 detail.cube_spec 当基准 —— 试算成功会就地更新
  // 它，那样重置就成了还原「刚试算过的那份」，越点越远。
  // cubeSpecLoaded = 打开本条时后端给的那份（可能是上一位标注员试算保存的人工口径，
  // 与 origin 不同），用来把「本次会话试算过」与「先前已试算并保存」分开。
  const [cubeSpecDraft, setCubeSpecDraft] = useState("");
  const [cubeSpecOrigin, setCubeSpecOrigin] = useState("");
  const [cubeSpecLoaded, setCubeSpecLoaded] = useState("");
  const [cubeOriginKnown, setCubeOriginKnown] = useState(false);
  const [cubePreview, setCubePreview] = useState<CubePreviewResponse | null>(null);
  const [cubeError, setCubeError] = useState("");
  const [previewing, setPreviewing] = useState(false);
  const [badTypes, setBadTypes] = useState<BadType[]>([]);
  const [busyKey, setBusyKey] = useState(""); // judge 中防抖
  const [deleting, setDeleting] = useState(""); // 正在删除的条目 key（单条，防连点）
  // 批量清空：比单条重一档的确认，要求把条数敲进去
  const [clearOpen, setClearOpen] = useState(false);
  const [clearInput, setClearInput] = useState("");
  const [clearing, setClearing] = useState(false);

  // selKey 的镜像：refreshList 要在「拉回来之后」判断选中项还在不在，而它不该因为
  // selKey 变化就重建（那会让下面那个拉详情的 effect 反复触发）。用 ref 读当下值。
  const selKeyRef = useRef<string | null>(null);
  const selectKey = useCallback((k: string | null) => {
    selKeyRef.current = k;
    setSelKey(k);
  }, []);

  const refreshList = useCallback(
    async (tab: "" | AnnotationStatus) => {
      setLoadingList(true);
      try {
        const resp = await fetchAnnotations(tab, 100);
        setList(resp.annotations);
        // 保留**仍然存在**的选中项，它不在了才回退第一条。之前是无条件选第一条：
        // 删掉当前这条会静默跳到第一行，看起来像删错了。
        const keys = resp.annotations.map(
          (a) => `${a.thread_id}::${a.message_id}`
        );
        const cur = selKeyRef.current;
        const keep = cur && keys.includes(cur) ? cur : (keys[0] ?? null);
        selectKey(keep);
        // 一条都不剩（或选中项已消失且列表也空了）：详情必须显式清掉，否则面板会
        // 继续渲染一条已经不存在的记录，按钮全打在一个不存在的行上。
        if (!keep) setDetail(null);
      } catch (e) {
        toast.error(`拉取队列失败: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        setLoadingList(false);
      }
    },
    [selectKey]
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

  // 统计条：失败就整条不渲染（后端 60s TTL 缓存兜住重复请求，所以列表一变就重新拉，
  // 确认/驳回之后数字立刻是对的）。
  const refreshStats = useCallback(async () => {
    try {
      setStats(await fetchDatasetStats());
    } catch {
      setStats(null);
    }
  }, []);

  // 存量 GoodCase 条目补 message_id：2026-09-19 之前入集的条目 metadata 里没有
  // message_id，而撤回端点要靠它去找本地标注行（Langfuse Dataset API 只有 trace_id，
  // 而一条 trace 可能承载同会话多条反馈）。这里用「该会话下唯一的 good 标注」反查——
  // 只有一个候选才敢认，0 个或多个一律不猜（后端对多条也会拒绝，双保险）。
  const [goodAnns, setGoodAnns] = useState<Annotation[]>([]);
  useEffect(() => {
    if (statusTab !== "good") return;
    fetchAnnotations("good", 200)
      .then((r) => setGoodAnns(r.annotations))
      .catch(() => setGoodAnns([]));
  }, [statusTab, dsList]);

  const midFor = useCallback(
    (it: DatasetItem): string => {
      if (it.message_id) return it.message_id;
      const cands = goodAnns.filter((a) => a.thread_id === it.session_id);
      return cands.length === 1 ? cands[0].message_id : "";
    },
    [goodAnns]
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
        // Cube 口径草稿：后端给的是对象，文本框里放格式化 JSON 才可编辑
        const spec0 =
          a.cube_spec && Object.keys(a.cube_spec).length > 0
            ? JSON.stringify(a.cube_spec, null, 2)
            : "";
        setCubeSpecDraft(spec0);
        setCubeSpecLoaded(spec0);
        // 「模型原口径」以后端回显的不可变快照为准（cube_original）；它缺席
        // （反馈记录被撤销等）才退回「打开时看到的这份」，同时记下这份基准其实不
        // 可信，别在界面上把上一位标注员的口径写成「模型原口径」。
        const origObj = a.cube_original;
        const hasOrig = Boolean(origObj && Object.keys(origObj).length > 0);
        setCubeSpecOrigin(hasOrig ? JSON.stringify(origObj, null, 2) : spec0);
        setCubeOriginKnown(hasOrig);
        setCubePreview(null);
        setCubeError("");
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

  useEffect(() => {
    refreshStats();
  }, [refreshStats, list, dsList]);

  // 选中项变化（含切 tab 后自动选第一条）→ 拉详情
  useEffect(() => {
    if (selKey) {
      const [tid, mid] = selKey.split("::");
      loadDetail(tid, mid);
    }
  }, [selKey, loadDetail]);

  const onSelect = (tid: string, mid: string) => {
    selectKey(`${tid}::${mid}`);
  };

  // 单条硬删：队列条目 + 这条消息的用户反馈一起删。不可恢复。
  const onDelete = async (tid: string, mid: string, expectedStatus: string) => {
    const key = `${tid}::${mid}`;
    const ok = window.confirm(
      "删除这条待评估记录？\n\n" +
        "· 队列条目与这条消息的用户反馈（👍/👎）会一起删掉，聊天里不再显示该反馈\n" +
        "· 硬删除，没有回收站，不可恢复\n" +
        "· 历史反馈统计会随之变化（按时间分窗，无法追溯还原）"
    );
    if (!ok) return;
    setDeleting(key);
    try {
      await deleteAnnotation(tid, mid, expectedStatus);
      toast.success("已删除（含该消息的用户反馈）");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // 409 的两种情形（本条已被确认入集；状态在确认窗口内变了）都带着「该做什么」的
      // 文案，原样透出去。404「标注不存在」则是另一回事：别处已经删过了，不是失败。
      if (msg.includes("不存在")) toast.info(msg);
      else toast.error(msg);
    } finally {
      setDeleting("");
      await refreshList(statusTab);
      refreshStats();
    }
  };

  // 清空某个本地状态的全部条目（同单条：连带用户反馈）
  const onClear = async () => {
    if (!isDeletable(statusTab)) return;
    setClearing(true);
    try {
      const resp = await clearAnnotations(statusTab);
      if (resp.capped) {
        // 撞到单次上限：没清干净，如实说，别报「已清空」。
        toast.warning(
          `已删除 ${resp.deleted} 条，仍有 ${resp.remaining} 条未处理（单次上限）：请再点一次`
        );
      } else if (resp.skipped > 0) {
        toast.success(
          `已删除 ${resp.deleted} 条（${resp.skipped} 条在删除期间被确认入集，已跳过）`
        );
      } else {
        toast.success(`已删除 ${resp.deleted} 条`);
      }
      setClearOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setClearing(false);
      await refreshList(statusTab);
      refreshStats();
    }
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

  /** 按编辑后的 Cube 口径试算：定义 → 物理 SQL → 只读执行 → 结果表。
   *
   * 与 onExecute 的分工：Cube 通道的 SQL 由 wren 引擎服务端编译，标注员改不了也看不到，
   * 能改的是聚合口径（cube/measures/dimensions/filters）。后端把口径编译成物理 SQL 并
   * 执行，顺带把引擎原话（如 Unknown measure）带回来 —— 等于给口径一个拼写检查。
   *
   * 不推进状态、不写金标：试算通过 ≠ 金标就绪（后端只在成功后把口径落库，刷新还在）。 */
  const onPreviewCube = async () => {
    if (!detail) return;
    if (!cubeSpecDraft.trim()) {
      toast.error("请先填写 Cube 查询定义");
      return;
    }
    setPreviewing(true);
    setCubeError("");
    try {
      const resp = await previewCubeAnnotation(
        detail.thread_id,
        detail.message_id,
        cubeSpecDraft,
        dbName
      );
      setCubePreview(resp);
      // 后端把入参规范化了（列表排序、剥边界参数）→ 回填草稿，避免「我看到的」
      // 与「试算用的」不一致；本地 detail 同步，免得下次 loadDetail 又变回去
      const norm = JSON.stringify(resp.spec, null, 2);
      setCubeSpecDraft(norm);
      setDetail((prev) => (prev ? { ...prev, cube_spec: resp.spec } : prev));
      toast.success(`试算成功：${resp.result.row_count ?? "?"} 行`);
    } catch (e) {
      setCubePreview(null);
      const msg = e instanceof Error ? e.message : String(e);
      setCubeError(msg);
      toast.error(`试算失败: ${msg}`);
    } finally {
      setPreviewing(false);
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

  /** 撤回入集（GoodCase 专有）。二次确认不可省：这是**真删**数据集条目。 */
  const onRevokeGood = async (it: DatasetItem) => {
    const mid = midFor(it);
    if (!mid) return;
    const extra = it.message_id
      ? ""
      : "\n（该条目入集时没记消息 id，已按本会话唯一的正样本反查定位）";
    if (
      !window.confirm(
        `撤回后 Langfuse 里这条 Good Case 会被真删，本地条目回到「待判断」。${extra}\n确定撤回？`
      )
    ) {
      return;
    }
    setRevoking(true);
    try {
      const resp = await revokeGoodAnnotation(it.session_id, mid);
      if (resp.warning) {
        toast.warning(`已撤回（${resp.warning}）`);
      } else {
        toast.success(`已移出 Good Set（删除 ${resp.deleted_items} 条数据集条目）`);
      }
      await refreshDataset(statusTab);
      refreshStats();
    } catch (e) {
      // 后端把「定位不了」（409）与「删失败」（502）都带了明确原因，原样透出去——
      // 这里最需要的不是「失败」三个字，而是「接下来该做什么」。
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setRevoking(false);
    }
  };

  const status = detail?.status ?? "queued";
  // 正例（点赞）的主操作是「直接入 Good Set」，「进入标注」对正例是次要/例外路径
  const isPositive = detail?.rating === "positive";
  // 「直接入 Good Set」要求后端有 SQL 快照（gold_sql/bad_sql）。详情加载时会惰性
  // 补齐（含 Cube 通道按查询定义复算出的物理 SQL），故这里点前就能判定——纯文本
  // 回答（闲聊/澄清）恒无 SQL，那种情况不该让用户点出一个必 400 的按钮。
  const hasSql = Boolean((detail?.bad_sql || detail?.gold_sql || "").trim());
  // 「本条是不是 Cube 通道」的唯一判据 = 详情里带不带口径定义（后端非 Cube 恒给空对象，
  // 见 store.AnnotationRecord.cube_spec）。Cube 条目才有口径试算卡片。
  const isCubeChannel = Boolean(
    detail?.cube_spec && Object.keys(detail.cube_spec).length > 0
  );
  // 口径四态（试算会落库，所以「先前试算过」得与「本次试算过」分开数）：
  //   origin    草稿 == 模型原口径
  //   confirmed 草稿 == 打开时后端给的那份，且它不是模型原口径 → 上一位标注员试算并保存过
  //   edited    草稿既不是原口径也不是打开时那份 → 本次改过
  //   trialed   草稿 == 本次试算返回的规范化口径
  // 试算成功那一刻起，这份口径就是**人工背书**过的——确认入集时随 expected_output.cube
  // 一起进 Dataset（后端取 ann.cube_spec），同时模型那份另以 cube_original 留档。
  const trialedSpec = cubePreview ? JSON.stringify(cubePreview.spec, null, 2) : "";
  const cubeState: "origin" | "confirmed" | "edited" | "trialed" =
    cubeSpecDraft === cubeSpecOrigin
      ? "origin"
      : trialedSpec && cubeSpecDraft === trialedSpec
        ? "trialed"
        : cubeSpecLoaded && cubeSpecDraft === cubeSpecLoaded
          ? "confirmed"
          : "edited";
  // 口径与金标是否指向同一条语句：入集后 expected_output.sql（金标）与 .cube（口径）
  // 若各说各话，下游评测就会拿两个互不匹配的期望值。改口径后必须让两者重新对齐
  // （用试算出的物理 SQL 去「执行验证」一次即可），所以这里显式提示。
  const goldForCompare = (goldSql || sqlDraft).trim();
  const cubeSqlMismatch = Boolean(
    cubePreview && goldForCompare && cubePreview.physical_sql.trim() !== goldForCompare
  );
  const selectedId = detail ? `${detail.thread_id}::${detail.message_id}` : null;
  const isTerminal =
    status === "rejected" || status === "badcase" || status === "good";
  // 批量确认里的条数必须取统计条的**实时**计数，不能用 list.length：列表是按
  // limit=100 拉的，一个有 340 条的 Tab 会显示「100」却删掉 340 条。
  const clearCount =
    (stats?.queue as Record<string, number> | undefined)?.[statusTab] ??
    list.length;

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
          <StatsStrip stats={stats} onTab={setStatusTab} />
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              if (isDatasetTab) refreshDataset(statusTab);
              else refreshList(statusTab);
              refreshStats();
            }}
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
          <div className="flex flex-wrap items-center gap-1 border-b border-border p-2">
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
            {/* 清空只对四个本地状态开放。`""`（全部）与两个数据集 Tab 一律没有：
                「全部」里混着 good/badcase 行，一次清空会把它们的 Langfuse 产物
                留成孤儿；数据集 Tab 有各自的撤回路径。 */}
            {isDeletable(statusTab) && (
              <button
                onClick={() => {
                  setClearInput("");
                  setClearOpen(true);
                }}
                disabled={clearing || loadingList}
                className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                title={`清空「${STATUS_LABEL[statusTab as AnnotationStatus]}」里的全部记录（连同用户反馈，不可恢复）`}
              >
                <Trash2 className="size-3.5" />
                清空本 Tab
              </button>
            )}
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
                      {/* 缺金标：expected_output.sql 为空 → 这条只能验证「跑不跑得通」，
                          验证不了「答对没」。列表里一眼看到，才有人去补。 */}
                      {isBad && !it.has_gold && (
                        <span
                          className="mt-1 inline-block rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700"
                          title="没有 expected_output.sql：只能验证「跑不跑得通」，验证不了「答对没」"
                        >
                          缺金标
                        </span>
                      )}
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
                // 逐行按状态门控：`""`（全部）Tab 里混着 good/badcase 行，它们有
                // Langfuse 产物，只能在各自的「撤回」路径里处理。
                const canDelete = isDeletable(a.status);
                const rowDeleting = deleting === key;
                return (
                  // 外层是 div、内层才是选中按钮：删除键与选中按钮必须并列（button
                  // 不能嵌套 button，那是非法 HTML）。
                  <div
                    key={key}
                    className={cn(
                      "group mb-1 flex w-full items-start rounded-md border p-2.5 transition-colors",
                      selectedId === key
                        ? "border-foreground/40 bg-accent"
                        : "border-border hover:bg-accent/50"
                    )}
                  >
                    <button
                      onClick={() => onSelect(a.thread_id, a.message_id)}
                      className="min-w-0 flex-1 text-left"
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
                    {canDelete && (
                      <button
                        onClick={() => onDelete(a.thread_id, a.message_id, a.status)}
                        // 正在确认/执行这一条时不给删：那些操作在飞，删掉会留下
                        // 「金标 SQL 已执行、条目却没了」这种半成品。
                        disabled={rowDeleting || busyKey === key}
                        className="ml-1 shrink-0 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive focus:opacity-100 group-hover:opacity-100 disabled:opacity-40"
                        title="删除这条记录（连同该消息的用户反馈，不可恢复）"
                      >
                        {rowDeleting ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="size-3.5" />
                        )}
                      </button>
                    )}
                  </div>
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
                {(() => {
                  const it = dsList.find((i) => i.item_id === dsSel);
                  if (!it) return null;
                  return (
                    <DatasetDetail
                      it={it}
                      isBad={statusTab === "badcase"}
                      revocable={Boolean(midFor(it))}
                      revoking={revoking}
                      onRevoke={() => onRevokeGood(it)}
                    />
                  );
                })()}
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
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {isPositive && (
                      <Button
                        size="sm"
                        onClick={onJudgeGood}
                        disabled={busyKey === selectedId || !hasSql}
                        title={
                          hasSql
                            ? "点赞反馈判断有效后直接写入 Dataset:goodcase，无需再修正/验证 SQL"
                            : "本条回答未产生 SQL（如纯文本回答/澄清/闲聊），无法直接入 Good Set —— 请走「进入标注」手工填写 SQL"
                        }
                      >
                        <ThumbsUp className="mr-1.5 size-4" />
                        有效查询，直接入 Good Set
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant={isPositive ? "outline" : "default"}
                      onClick={() => onJudge(true)}
                      disabled={busyKey === selectedId}
                      title={
                        isPositive
                          ? hasSql
                            ? "点赞反馈通常应走左侧「直接入 Good Set」；仅当模型 SQL 需人工修正时才走这里"
                            : "本条回答没有 SQL，走这里手工填写后再确认入 Good Set"
                          : undefined
                      }
                    >
                      <CheckCircle2 className="mr-1.5 size-4" />
                      {isPositive ? "需人工修正 SQL，进入标注" : "有效反馈，进入标注"}
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
                  {isPositive && !hasSql && (
                    <p className="mt-2 rounded-md border border-rose-200 bg-rose-50 px-2 py-1.5 text-xs text-rose-600">
                      本条回答没有 SQL（纯文本回答/澄清/闲聊），「直接入 Good Set」不可用。
                      若它确实是数据查询，请点「进入标注」手工填写 SQL，再确认入 Good Set。
                    </p>
                  )}
                </div>
              )}

              {/* 标注（annotating / validated） */}
              {!isTerminal && status !== "queued" && (
                <>
                  {/* Cube 口径试算：Cube 通道**没有可改的 SQL**（SQL 由 wren 引擎按口径
                      服务端编译，模型和标注员都只写定义），能改的只有这份聚合口径。 */}
                  {isCubeChannel && (
                    <div className="rounded-lg border border-sky-200 bg-sky-50/40 p-4 shadow-sm">
                      <p className="flex items-center gap-2 text-sm font-medium text-sky-800">
                        <Boxes className="size-4" />
                        Cube 聚合口径（先试算，再确认金标）
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        本条走 <span className="font-mono">query_cube</span> 通道：下方
                        「修正并验证 SQL」里的 SQL 是引擎按这份口径
                        <span className="font-medium">复算</span>
                        出来的物理 SQL，改它没用（下次查询仍按口径重编）。口径是
                        <span className="font-mono">cube / measures / dimensions / filters</span>
                        这套定义，改完点「按新口径试算」——后端会用平台同一套编译跑一遍，
                        编译不过会把引擎原话（如 Unknown measure）原样报出来。
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        <span className="font-medium">试算成功即视为人工确认这份口径</span>
                        ：确认入 BadCase / Good Set 时它会随条目一起入集
                        （<span className="font-mono">expected_output.cube</span>），成为该题的
                        金标聚合口径；不试算则沿用模型原始口径（那份可能是错的、也不可执行）。
                        模型那份也<span className="font-medium">不会被丢掉</span>：入集时另存为
                        <span className="font-mono">metadata.cube_original</span>
                        ，用于比对「人工把口径改成了什么」。
                      </p>
                      <Textarea
                        value={cubeSpecDraft}
                        onChange={(e) => setCubeSpecDraft(e.target.value)}
                        placeholder={'{\n  "cube": "workhour_analysis",\n  "measures": ["total_hours"],\n  "dimensions": ["dept_level1"]\n}'}
                        rows={8}
                        className="mt-2 font-mono text-xs"
                      />
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <Button
                          size="sm"
                          onClick={onPreviewCube}
                          disabled={previewing || !cubeSpecDraft.trim()}
                          title="按编辑后的口径编译成物理 SQL 并只读执行（不改状态、不写金标）"
                        >
                          <Play className="mr-1.5 size-4" />
                          {previewing ? "试算中…" : "按新口径试算"}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setCubeSpecDraft(cubeSpecOrigin)}
                          disabled={!cubeSpecOrigin || cubeSpecDraft === cubeSpecOrigin}
                          title={
                            cubeOriginKnown
                              ? "恢复成模型那次实际用的口径（试算成功会更新草稿，但不是「原口径」）"
                              : "本条拿不到模型原口径（反馈快照缺失），这里只能退回到打开本条时的那份"
                          }
                        >
                          <RotateCcw className="mr-1.5 size-4" />
                          重置为模型原口径
                        </Button>
                        <span
                          className={cn(
                            "rounded-full px-2 py-0.5 text-[11px]",
                            cubeState === "trialed" || cubeState === "confirmed"
                              ? "bg-emerald-100 text-emerald-700"
                              : cubeState === "edited"
                                ? "bg-amber-100 text-amber-700"
                                : "bg-muted text-muted-foreground"
                          )}
                        >
                          {cubeState === "trialed"
                            ? "已试算（口径经人工确认）"
                            : cubeState === "confirmed"
                              ? "已保存的人工口径（先前试算过）"
                              : cubeState === "edited"
                                ? "已修改，尚未试算"
                                : cubeOriginKnown
                                  ? "模型原口径"
                                  : "当前口径（原口径不可得）"}
                        </span>
                        <span className="text-[11px] text-muted-foreground">
                          执行库：{dbName || detail?.db_name || "（未指定）"}
                        </span>
                      </div>
                      {cubeError && (
                        <p className="mt-2 rounded-md border border-rose-200 bg-rose-50 px-2 py-1.5 text-xs text-rose-600">
                          {cubeError}
                        </p>
                      )}
                      {cubePreview && (
                        <div className="mt-3">
                          <div className="flex flex-wrap items-center gap-2 text-xs text-emerald-700">
                            <ShieldCheck className="size-3.5" />
                            口径可编译、可执行
                            <span className="text-muted-foreground">
                              （共 {cubePreview.result.row_count ?? "?"} 行；窗口由平台截取，
                              与线上工具一致）
                            </span>
                          </div>
                          <details className="mt-2 rounded-md border border-border bg-card">
                            <summary className="cursor-pointer px-2 py-1.5 text-xs text-muted-foreground">
                              执行 SQL（物理，实际下发 · {cubePreview.physical_sql.length} 字符）
                              —— 口径编译后的产物，标注员平时看不到这条
                            </summary>
                            <pre className="max-h-72 overflow-auto border-t border-border px-2 py-1.5 font-mono text-[11px] whitespace-pre-wrap">
                              {cubePreview.physical_sql}
                            </pre>
                          </details>
                          {cubeSqlMismatch && (
                            <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-700">
                              这份口径编译出的物理 SQL 与上方金标 SQL 不同：入集后
                              <span className="font-mono">expected_output.sql</span> 与
                              <span className="font-mono">.cube</span> 会各说各话。若新口径才是
                              对的，请把下面这条物理 SQL 贴回上方「修正并验证 SQL」再点一次
                              「执行验证」，让金标与口径对齐。
                            </p>
                          )}
                          <div className="mt-2">
                            <ResultTable result={cubePreview.result} />
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
                    <p className="text-sm font-medium">
                      {isCubeChannel ? "修正并验证 SQL（Cube 通道：物理 SQL，通常无需改）" : "修正并验证 SQL"}
                    </p>
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
                      {detail.auto_good === 1 && (
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          本条由「点赞自动入集」写入（没有人点过确认）：门槛只看「点赞
                          + 有 SQL + 非闲聊」，不看五维分。需要移出请到左侧 GoodCase
                          模块撤回，或直接取消点赞（会自动收回）。
                        </p>
                      )}
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
                      已驳回（无效 / 误报 / 闲聊）。误驳了可以删掉这一条，用户重新点赞/点踩
                      会重新入队（不是同一条历史）。
                    </p>
                  )}
                </div>
              )}

              {/* 删除（硬删，不可恢复）：只对四个本地状态渲染。good/badcase 在
                  Langfuse 有产物（Dataset 条目 / badcase_status 标记），删本地行会把它
                  们留成孤儿，二者各有自己的撤回路径（撤回入集 / 数据集 UI），故不在此列。 */}
              {isDeletable(status) && (
                <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
                  <p className="flex items-center gap-2 text-sm font-medium text-destructive">
                    <Trash2 className="size-4" />
                    删除这条记录
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    队列条目与这条消息的用户反馈（👍/👎）会一起删掉，聊天里也不再显示该反馈；
                    硬删除、没有回收站，历史反馈统计会随之变化。仅用于误点、垃圾样本、重复条目。
                  </p>
                  <Button
                    variant="destructive"
                    size="sm"
                    className="mt-3"
                    onClick={() =>
                      onDelete(detail.thread_id, detail.message_id, detail.status)
                    }
                    disabled={deleting === selectedId || busyKey === selectedId}
                  >
                    {deleting === selectedId ? (
                      <Loader2 className="mr-1.5 size-4 animate-spin" />
                    ) : (
                      <Trash2 className="mr-1.5 size-4" />
                    )}
                    {deleting === selectedId ? "删除中…" : "删除这条（含用户反馈）"}
                  </Button>
                </div>
              )}
            </div>
          )}
        </main>
      </div>

      {/* 批量清空：比单条重一档的确认（要求把条数敲进去才解锁）。仓里没有 AlertDialog，
          沿用 WorkspacePanel 的 shadcn Dialog + variant=destructive 先例。 */}
      <Dialog
        open={clearOpen}
        onOpenChange={(o) => {
          if (!o && !clearing) setClearOpen(false);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              清空「{STATUS_LABEL[statusTab as AnnotationStatus] ?? statusTab}
              」的全部记录？
            </DialogTitle>
            <DialogDescription className="text-xs">
              共 <b className="text-foreground">{clearCount}</b> 条，删除后不可恢复。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 text-xs leading-relaxed text-muted-foreground">
            <p className="text-destructive">
              ⛔ 每条的<b>用户反馈（👍/👎）会一起删掉</b>，聊天里不再显示；Langfuse 侧会写入撤销分。
            </p>
            <p>历史反馈统计会随之变化（按时间分窗，无法追溯还原）。</p>
            <p>
              输入条数 <b className="text-foreground">{clearCount}</b> 以确认：
            </p>
            <Input
              className="h-8"
              value={clearInput}
              onChange={(e) => setClearInput(e.target.value)}
              placeholder={String(clearCount)}
              disabled={clearing}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setClearOpen(false)}
              disabled={clearing}
            >
              取消
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={onClear}
              disabled={clearing || clearInput.trim() !== String(clearCount)}
            >
              {clearing ? (
                <Loader2 className="mr-1.5 size-4 animate-spin" />
              ) : (
                <Trash2 className="mr-1.5 size-4" />
              )}
              {clearing ? "清空中…" : "清空"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
