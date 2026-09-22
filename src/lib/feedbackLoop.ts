// 反馈闭环 API 客户端（待标注队列）。
// 对应后端 src/api/feedback_annotation.py。
// 与 /feedback/annotate 页（标注）配套。
import { getConfig } from "@/lib/config";

const apiBase = (): string => {
  const cfg = getConfig();
  const base = cfg?.deploymentUrl || "http://localhost:2026";
  return base.replace(/\/+$/, "");
};

function authFetch(url: string, init?: RequestInit): Promise<Response> {
  return fetch(url, { ...init, credentials: "include" });
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await authFetch(`${apiBase()}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  let data: Record<string, unknown> = {};
  try {
    data = await res.json();
  } catch {
    /* 非 JSON 响应 */
  }
  if (!res.ok) {
    const msg =
      typeof data.error === "string" && data.error
        ? data.error
        : `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data as T;
}

// ── 标注队列 ──────────────────────────────────────────

export type AnnotationStatus =
  | "queued"
  | "annotating"
  | "validated"
  | "rejected"
  | "badcase"
  | "good";

export interface Annotation {
  thread_id: string;
  message_id: string;
  feedback_type: string;
  question: string;
  /** Cube 通道的规范化查询定义（对象，非 JSON 串——后端 `AnnotationRecord` 走
   *  `asdict`）。非 Cube 通道为空对象 `{}`：**这是「本条是不是 Cube 通道」的判据**。 */
  cube_spec: Record<string, unknown>;
  /** **模型原始**那份口径（只读回显，不落库、不入数据集）：取自不可变反馈快照。
   *  `cube_spec` 会被「按新口径试算」就地改写，之后详情里就再看不到模型那份了——
   *  「重置为模型原口径」与三态标记必须以此为基准才说得准（否则第二次打开看到的
   *  「原口径」其实是上一位标注员试算保存的那份）。取不到时为空对象 `{}`。
   *  与入集 dataset 的 `metadata.cube_original` 是同一份东西（那边是 JSON 串）。 */
  cube_original: Record<string, unknown>;
  bad_sql: string;
  exec_error: string;
  note: string;
  rating: string;
  db_name: string;
  status: AnnotationStatus;
  is_valid: number | null;
  gold_sql: string;
  gold_result: string;
  bad_type: string;
  annotator: string;
  created_at: string;
  annotated_at: string;
  badcase_at: string;
  /** 1 = 本条 Good Set 由「点赞自动入集」写入（**没有任何人点过确认**）。0 = 人工确认
   *  或未入集。用途：详情页提示这是机器写的；用户撤销点赞时后端只自动收回这一种。 */
  auto_good: number;
}

export interface BadType {
  key: string;
  label: string;
  desc: string;
}

export interface ExecResult {
  columns: string[];
  rows: Record<string, unknown>[];
  row_count: number;
  [k: string]: unknown;
}

export interface AnnotationListResponse {
  count: number;
  annotations: Annotation[];
}

export async function fetchAnnotations(
  status: string,
  limit = 50
): Promise<AnnotationListResponse> {
  const q = status
    ? `?status=${encodeURIComponent(status)}&limit=${limit}`
    : `?limit=${limit}`;
  return request<AnnotationListResponse>(`/api/feedback/annotations${q}`);
}

// ── Langfuse Dataset 直读（BadCase / Good Set 模块，与 Langfuse UI Dataset 一致）──

export type DatasetSource = "auto-collect" | "user-annotation" | string;

export interface DatasetItem {
  item_id: string;
  question: string;
  session_id: string;
  sql: string;
  /** Cube 通道的规范化查询定义（JSON 串，measures/dimensions/filters…）。
   *  非 Cube 条为空串。老条目（2026-09-19 前入集）也可能为空串。 */
  cube_spec: string;
  /** 模型**实际下发**的那条 SQL（Cube 通道为复算物理 SQL）。与上方的 `sql`
   *  （金标／人工确认过的）不同才是信息：自动采集条没有金标，只有这一个；
   *  非查询条或老条目为空串。`_original` = 「模型原本那份」（入集 dataset 里
   *  同名 metadata 键）。 */
  physical_sql_original: string;
  /** 用户在反馈里写的评论（点赞/差评时的备注）。自动采集条也可能有（取自本地
   *  反馈快照）；纯自动采集且无评论时为空串。 */
  note: string;
  source: DatasetSource; // auto-collect / user-annotation / auto-good
  /** 该条目对应的聊天消息 id——**撤回入集时的定位键**（Langfuse Dataset API 没有
   *  可读的消息标识，只有 trace_id，而一条 trace 可能承载同会话多条反馈）。
   *  2026-09-19 之前入集的条目为空串，撤回时后端只在其为该 trace 下唯一条目时才敢删。 */
  message_id: string;
  /** `expected_output.sql` 非空 = 这条有**机器可读的权威金标**。badcase 里
   *  `has_gold === false` 的就是「待补金标」——只能验证"还跑不跑得通"，
   *  验证不了"这次答对了没"。 */
  has_gold: boolean;
  db_name: string;
  trace_id: string;
  bad_type: string;
  rating: string;
  reasons: string[];
  created_at: string;
  collected_at: string;
}

export interface DatasetListResponse {
  dataset: string;
  count: number;
  items: DatasetItem[];
}

export async function fetchDatasetItems(
  name: "badcase" | "goodcase",
  limit = 200
): Promise<DatasetListResponse> {
  return request<DatasetListResponse>(
    `/api/feedback/datasets?name=${encodeURIComponent(name)}&limit=${limit}`
  );
}

export const SOURCE_LABEL: Record<string, string> = {
  "auto-collect": "自动采集",
  "user-annotation": "人工确认",
  // 用户点赞即刻入集，中间没有人点过确认。标注出来是因为它与人写的条目可信度不同：
  // 门槛是宽松的（只看「点赞 + 有 SQL + 非闲聊」，不看分数），复核时优先看这批。
  "auto-good": "自动入集",
};

// ── 数据集规模与金标缺口（标注页头部统计条）──

export interface DatasetStat {
  total: number;
  with_gold: number;
  without_gold: number;
  by_source: Record<string, number>;
}

export interface DatasetStatsResponse {
  /** 本地队列深度（零网络，天然最新）。六个状态一律有值。 */
  queue: Record<AnnotationStatus, number>;
  badcase: DatasetStat;
  goodcase: DatasetStat;
  /** Langfuse 未接入 —— 此时两个数据集是「真的没有」而非「有 0 条」。 */
  disabled?: boolean;
  error?: string;
}

export async function fetchDatasetStats(): Promise<DatasetStatsResponse> {
  return request<DatasetStatsResponse>("/api/feedback/dataset-stats");
}

/** 撤回入集：删掉 Langfuse 里这条 Dataset item，本地条目回到「待判断」。
 *  后端不变量是「本地 status=good ⇔ 数据集里有这条」，所以删不掉时会抛错而不是
 *  悄悄回退本地——把错误原样透出去，让人知道该去 Langfuse UI 手动处理。 */
export async function revokeGoodAnnotation(
  threadId: string,
  messageId: string
): Promise<{ ok: boolean; deleted_items: number; warning?: string }> {
  const data = await request<{
    ok: boolean;
    deleted_items: number;
    warning?: string;
  }>(
    `/api/feedback/annotations/${encodeURIComponent(threadId)}/${encodeURIComponent(messageId)}/revoke-good`,
    { method: "POST" }
  );
  if (!data.ok) throw new Error("撤回失败");
  return data;
}

/** 可被「删除」的四个本地状态（与后端 `store.ANNOTATION_DELETABLE` **逐字一致**）。
 *
 * `good` / `badcase` 不在其中：它们在 Langfuse 有产物（Dataset 条目、badcase_status
 * 标记），删掉本地行会把那些产物留成孤儿，二者各有自己的撤回路径（撤回入集 / 数据集
 * UI）。判据必须是这个**正白名单**：`""`（全部）Tab 里混着 good/badcase 行，用
 * 「不是 good/badcase 就能删」的反向判断会连它们一起删掉。 */
export const ANNOTATION_DELETABLE: readonly AnnotationStatus[] = [
  "queued",
  "annotating",
  "validated",
  "rejected",
];

/** 单条硬删：队列条目**连同它的用户反馈**一起删掉（聊天里那个 👍/👎 也会消失）。
 *  不可恢复，删了要重新反馈才会重新入队。 */
export async function deleteAnnotation(
  threadId: string,
  messageId: string,
  expectedStatus: string
): Promise<{ ok: boolean; deleted: { annotation: boolean; feedback: boolean } }> {
  // expectedStatus 走后端 CAS：前端看到的这段时间里这条若已被确认入集（变 badcase），
  // 后端会拒删并返回 409（连带说明反馈已移除），而不是删掉它、留下孤儿数据集条目。
  return request<{
    ok: boolean;
    deleted: { annotation: boolean; feedback: boolean };
  }>(
    `/api/feedback/annotations/${encodeURIComponent(threadId)}/${encodeURIComponent(messageId)}`,
    {
      method: "DELETE",
      body: JSON.stringify({ expected_status: expectedStatus }),
    }
  );
}

/** 批量清空某个本地状态的**全部**条目（同样连带用户反馈，不可恢复）。 */
export interface ClearAnnotationsResponse {
  ok: boolean;
  status: string;
  deleted: number;
  feedback_deleted: number;
  /** 循环期间状态变成终态、被 CAS 跳过没删的条数。 */
  skipped: number;
  /** 清完之后该状态还剩多少条（超过上限时不为 0，如实体现）。 */
  remaining: number;
  /** 已排队的撤销哨兵条数（后台线程写的，不是已写入数）。 */
  scores_queued: number;
  /** 是否撞到了单次上限（撞到就是没清干净，别显示「已清空」）。 */
  capped: boolean;
}

export async function clearAnnotations(
  status: string
): Promise<ClearAnnotationsResponse> {
  const data = await request<ClearAnnotationsResponse>(
    "/api/feedback/annotations/clear",
    { method: "POST", body: JSON.stringify({ status }) }
  );
  if (!data.ok) throw new Error("清空失败");
  return data;
}

export async function fetchAnnotation(
  threadId: string,
  messageId: string
): Promise<{ annotation: Annotation }> {
  return request<{ annotation: Annotation }>(
    `/api/feedback/annotations/${encodeURIComponent(threadId)}/${encodeURIComponent(messageId)}`
  );
}

export async function fetchBadTypes(): Promise<BadType[]> {
  const data = await request<{ bad_types: BadType[] }>(
    "/api/feedback/annotations/bad-types"
  );
  return data.bad_types ?? [];
}

export async function judgeAnnotation(
  threadId: string,
  messageId: string,
  isValid: boolean,
  annotator: string,
  directGood = false
): Promise<{ ok: boolean; annotation: Annotation }> {
  const data = await request<{ ok: boolean; annotation: Annotation }>(
    `/api/feedback/annotations/${encodeURIComponent(threadId)}/${encodeURIComponent(messageId)}/judge`,
    {
      method: "POST",
      body: JSON.stringify({
        is_valid: isValid,
        annotator,
        direct_good: directGood,
      }),
    }
  );
  if (!data.ok) throw new Error("judge 失败");
  return data;
}

export async function executeAnnotation(
  threadId: string,
  messageId: string,
  sql: string,
  dbName: string
): Promise<{ ok: boolean; result: ExecResult }> {
  const data = await request<{ ok: boolean; result: ExecResult }>(
    `/api/feedback/annotations/${encodeURIComponent(threadId)}/${encodeURIComponent(messageId)}/execute`,
    {
      method: "POST",
      body: JSON.stringify({ sql, db_name: dbName }),
    }
  );
  if (!data.ok) throw new Error("执行失败");
  return data;
}

/** 「按口径试算」的返回：口径 → 物理 SQL → 结果表。
 *
 * 与 `executeAnnotation`（人工 SQL 的执行校验）对称：Cube 通道结构上没有 SQL，
 * 标注员改完口径只能靠肉眼判断，这里把编辑后的定义交给平台同一套复算编译并执行。 */
export interface CubePreviewResponse {
  ok: boolean;
  /** 规范化后的定义（后端把入参列表排序、剥边界参数后的那份）。 */
  spec: Record<string, unknown>;
  /** 同上的人读多行文本（与入集 dataset 的 cube_spec_readable 同源）。 */
  cube_spec_readable: string;
  /** 真正会下发物理库的那条 SQL（标注员本来拿不到：Cube 工具不回传 SQL）。 */
  physical_sql: string;
  /** 引擎编译出的语义层中间 SQL（引用 MDL 视图，**不能**直连库执行）。 */
  cube_sql: string;
  dialect: string;
  result: ExecResult;
}

export async function previewCubeAnnotation(
  threadId: string,
  messageId: string,
  cubeSpec: string,
  dbName?: string
): Promise<CubePreviewResponse> {
  const data = await request<CubePreviewResponse>(
    `/api/feedback/annotations/${encodeURIComponent(threadId)}/${encodeURIComponent(messageId)}/preview-cube`,
    {
      method: "POST",
      body: JSON.stringify({ cube_spec: cubeSpec, db_name: dbName || undefined }),
    }
  );
  if (!data.ok) throw new Error("试算失败");
  return data;
}

export async function confirmAnnotation(
  threadId: string,
  messageId: string,
  payload: {
    gold_sql: string;
    bad_type: string;
    note?: string;
    db_name?: string;
    annotator?: string;
  }
): Promise<{ ok: boolean; annotation: Annotation }> {
  const data = await request<{ ok: boolean; annotation: Annotation }>(
    `/api/feedback/annotations/${encodeURIComponent(threadId)}/${encodeURIComponent(messageId)}/confirm`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    }
  );
  if (!data.ok) throw new Error("确认失败");
  return data;
}

export async function confirmGoodAnnotation(
  threadId: string,
  messageId: string,
  payload: {
    sql?: string;
    db_name?: string;
    annotator?: string;
  }
): Promise<{ ok: boolean; annotation: Annotation }> {
  const data = await request<{ ok: boolean; annotation: Annotation }>(
    `/api/feedback/annotations/${encodeURIComponent(threadId)}/${encodeURIComponent(messageId)}/confirm-good`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    }
  );
  if (!data.ok) throw new Error("确认失败");
  return data;
}
