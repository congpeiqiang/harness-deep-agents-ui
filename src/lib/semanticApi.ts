/**
 * 语义库管理 API 客户端
 *
 * 独立于 dbConfig.ts（DLP 加密），提供语义库相关的 API 函数和类型定义。
 * 后端路由: src/api/wren_semantic.py
 */
import { getConfig } from "@/lib/config";

// ── 类型定义 ─────────────────────────────────────────────────

export interface DbInfo {
  name: string;
  db_type: string;
  host: string;
  port: number;
  database: string;
  user: string;
  password?: string;
  password_configured?: boolean;
  semantic?: boolean;
  wren_project?: string;
  extra_config?: Record<string, unknown>;
}

export interface SemanticProject {
  path: string;
  name: string;
  project_name: string;
  source: "git" | "local";
  git: {
    remote: string;
    branch: string;
    commit: string;
    tag: string;
  } | null;
  built: boolean;
  models: number;
  views: number;
  relationships: number;
  cubes: number;
  data_source: string;
  associated_dbs: string[];
}

export interface IntrospectTable {
  name: string;
  comment: string;
  columns: {
    name: string;
    type: string;
    wren_type: string;
    nullable: boolean;
    comment: string;
    is_primary_key: boolean;
  }[];
  primary_key: string[];
  column_count: number;
}

export interface IntrospectForeignKey {
  source_table: string;
  source_column: string;
  target_table: string;
  target_column: string;
}

export interface CreateProjectPayload {
  project_name: string;
  db_name: string;
  description?: string;
}

export interface GenerateModelsPayload {
  selected_tables: string[];
  include_relationships?: boolean;
  db_name?: string;
}

export interface PushToGitPayload {
  remote_url: string;
  branch?: string;
  tag?: string;
  commit_message?: string;
  /** 强制覆盖远端（force push）；缺省 false，历史分叉时后端会拒绝并提示 */
  force?: boolean;
}

// ── 业务知识（wren v5 规范布局：knowledge/<分类>/*.md，一个文件一条知识）──
// wren 只消费 .md：rules/*.md 注入规则、sql/*.md 是 NL↔SQL 示例对（YAML front-matter）、
// glossary|metrics|caveats/*.md 供 get_all_knowledge 读取。

/** 自由 Markdown 条目（词汇表 / 指标 / 规则 / 注意事项） */
export interface KnowledgeFileItem {
  /** 文件名去 .md，即条目名 */
  name: string;
  /** 项目内相对路径：knowledge/<分类>/<文件名>.md */
  file: string;
  /** Markdown 正文，原样保存 */
  content: string;
}

/** SQL 示例条目：正文是一段 front-matter（nl + sql + 可选 datasource/tags） */
export interface KnowledgeSqlItem {
  name: string;
  file: string;
  /** 自然语言问题 */
  nl: string;
  /** 参考答案 SQL */
  sql: string;
  datasource?: string;
  tags?: string[];
  source?: string;
  created_at?: string;
  /** front-matter 之后的正文（备注） */
  body?: string;
}

export interface KnowledgeData {
  glossary: KnowledgeFileItem[];
  metrics: KnowledgeFileItem[];
  rules: KnowledgeFileItem[];
  sql_patterns: KnowledgeSqlItem[];
  caveats: KnowledgeFileItem[];
}

/** 保存载荷：Markdown 原文 + SQL 结构化字段（由后端用 wren 渲染器生成 front-matter）+ 删除 */
export interface KnowledgeSavePayload {
  files?: Record<string, string>;
  sql_pairs?: Record<
    string,
    {
      nl: string;
      sql: string;
      datasource?: string;
      tags?: string[];
      source?: string;
      body?: string;
    }
  >;
  /** 待删除的项目内相对路径（重命名 = 写新文件 + 删旧文件） */
  deletes?: string[];
}

export interface GitStatusInfo {
  ok: boolean;
  is_git: boolean;
  has_updates: boolean;
  has_local_changes: boolean;
  /** 会拦住「更新」的未提交改动（已跟踪文件，不含未跟踪/构建产物） */
  local_changes?: string[];
  /** target/ 下的构建产物改动：可再生，不拦更新 */
  generated_changes?: string[];
  branch: string;
  commit?: string;
  remote_branch?: string;
  remote_commit?: string;
  default_branch?: string;
  /** 非 Git 项目（is_git=false）才有：接管「接入 Git」会被替换掉的自建内容 */
  adopt_local_files?: string[];
  /** 非 Git 项目才有：是否只是刚建出来的空骨架（true 时接入无需确认） */
  adopt_pristine?: boolean;
  /** 非 Git 项目才有：是否已构建（target/mdl.json 存在算自建内容） */
  adopt_built?: boolean;
}

/** 远程分支 / tag（git-refs） */
export interface GitRef {
  name: string;
  sha: string;
}

export interface GitRefsInfo {
  ok: boolean;
  is_git: boolean;
  default_branch: string;
  branches: GitRef[];
  tags: GitRef[];
  current_branch?: string;
  current_commit?: string;
}

/** 更新（git-pull）结果 */
export interface GitPullResult {
  ok: boolean;
  message?: string;
  error?: string;
  kind?: "branch" | "tag";
  ref?: string;
  commit?: string;
  changed?: boolean;
  rebuild_required?: boolean;
  /** 被护栏拦下时的原因：dirty=有未提交改动，unpushed=有未推送提交 */
  blocked?: "dirty" | "unpushed" | "";
  /** blocked=dirty 时的具体文件清单 */
  dirty_files?: string[];
  /** 放弃本地改动并更新时的 stash 备份名（可 git stash pop 找回） */
  stash_ref?: string;
  discarded_files?: string[];
}

// ── API 基础 ─────────────────────────────────────────────────

const apiBase = (): string => {
  const cfg = getConfig();
  const base = cfg?.deploymentUrl || "http://localhost:2026";
  return base.replace(/\/+$/, "");
};

function authFetch(url: string, init?: RequestInit): Promise<Response> {
  return fetch(url, { ...init, credentials: "include" });
}

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const j = await res.json();
      msg = j.error || msg;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

// ── 数据库列表 ───────────────────────────────────────────────

export async function listDatabases(): Promise<DbInfo[]> {
  const res = await authFetch(`${apiBase()}/api/db-configs`, { cache: "no-store" });
  const j = await handle<{ databases: DbInfo[] }>(res);
  return j.databases || [];
}

// ── 语义库列表 ───────────────────────────────────────────────

export async function listSemanticProjects(): Promise<SemanticProject[]> {
  const res = await authFetch(`${apiBase()}/api/wren-projects`, { cache: "no-store" });
  const j = await handle<{ projects: SemanticProject[] }>(res);
  return j.projects || [];
}

// ── 新建语义库 ───────────────────────────────────────────────

export async function createSemanticProject(
  payload: CreateProjectPayload
): Promise<{ ok: boolean; project?: SemanticProject; path?: string; error?: string }> {
  const res = await authFetch(`${apiBase()}/api/wren-projects/create`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return handle(res);
}

export async function introspectTables(
  name: string,
  dbName?: string
): Promise<{
  ok: boolean;
  tables: IntrospectTable[];
  foreign_keys: IntrospectForeignKey[];
  db_name?: string;
  db_type?: string;
  error?: string;
}> {
  const res = await authFetch(`${apiBase()}/api/wren-projects/${encodeURIComponent(name)}/introspect`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ db_name: dbName || "" }),
  });
  return handle(res);
}

export async function generateModels(
  name: string,
  payload: GenerateModelsPayload
): Promise<{ ok: boolean; generated: { models: number; relationships: number }; error?: string }> {
  const res = await authFetch(
    `${apiBase()}/api/wren-projects/${encodeURIComponent(name)}/generate-models`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }
  );
  return handle(res);
}

// ── 业务知识 ─────────────────────────────────────────────────

export async function readKnowledge(
  name: string
): Promise<{ ok: boolean; knowledge: KnowledgeData }> {
  const res = await authFetch(
    `${apiBase()}/api/wren-projects/${encodeURIComponent(name)}/knowledge/read`,
    { cache: "no-store" }
  );
  return handle(res);
}

export async function saveKnowledge(
  name: string,
  payload: KnowledgeSavePayload
): Promise<{
  ok: boolean;
  saved: string[];
  deleted: string[];
  /** 被拒绝的路径（非法路径 / 空 nl+sql），前端需提示，不能当成功 */
  rejected: string[];
}> {
  const res = await authFetch(
    `${apiBase()}/api/wren-projects/${encodeURIComponent(name)}/knowledge/save`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }
  );
  return handle(res);
}

/** AI 补充返回的结构化草稿（前端负责渲染成 knowledge/<分类>/*.md 条目） */
export interface AiGeneratedKnowledge {
  glossary?: { name: string; definition: string; synonyms?: string[]; related_tables?: string[] }[];
  metrics?: {
    name: string;
    display_name?: string;
    type?: string;
    expression?: string;
    description?: string;
  }[];
  rules?: { name: string; category?: string; description: string }[];
  sql_patterns?: { name: string; questions?: string[]; template: string }[];
}

export async function aiGenerateKnowledge(
  name: string,
  options: {
    scope?: string[];
    industry?: string;
    notes?: string;
  } = {}
): Promise<{
  ok: boolean;
  generated: AiGeneratedKnowledge;
  mode: "ai" | "fallback";
  error?: string;
}> {
  const res = await authFetch(
    `${apiBase()}/api/wren-projects/${encodeURIComponent(name)}/knowledge/ai-generate`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(options),
    }
  );
  return handle(res);
}

export async function getKnowledgeTemplates(
  name: string
): Promise<{ templates: Record<string, string> }> {
  const res = await authFetch(
    `${apiBase()}/api/wren-projects/${encodeURIComponent(name)}/knowledge/template`,
    { cache: "no-store" }
  );
  return handle(res);
}

// ── Git 操作 ─────────────────────────────────────────────────

export async function pushToGit(
  name: string,
  payload: PushToGitPayload
): Promise<{ ok: boolean; message?: string; error?: string }> {
  const res = await authFetch(`${apiBase()}/api/wren-projects/${encodeURIComponent(name)}/push`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return handle(res);
}

export async function getGitStatus(name: string): Promise<GitStatusInfo> {
  const res = await authFetch(
    `${apiBase()}/api/wren-projects/${encodeURIComponent(name)}/git-status`,
    { cache: "no-store" }
  );
  return handle(res);
}

/** 远程分支/tag 列表（「更新」对话框的候选） */
export async function getGitRefs(name: string): Promise<GitRefsInfo> {
  const res = await authFetch(
    `${apiBase()}/api/wren-projects/${encodeURIComponent(name)}/git-refs`,
    { cache: "no-store" }
  );
  return handle(res);
}

/**
 * 更新语义库到远程指定 ref（分支或 tag）。
 * ref 留空 = 拉远程默认分支最新（后端按 ls-remote 探测，不依赖 origin/HEAD）。
 * discardLocal=true = 用户已显式确认放弃本地未提交改动：后端先 stash 备份再更新
 * （返回 stash_ref 可找回），否则后端直接拒绝（护栏：宁可拒绝也不覆盖用户数据）。
 */
export async function gitPull(
  name: string,
  ref?: string,
  discardLocal?: boolean
): Promise<GitPullResult> {
  const payload: { ref?: string; discard_local?: boolean } = {};
  if (ref) payload.ref = ref;
  if (discardLocal) payload.discard_local = true;
  const body = Object.keys(payload).length ? JSON.stringify(payload) : undefined;
  const res = await authFetch(`${apiBase()}/api/wren-projects/${encodeURIComponent(name)}/git-pull`, {
    method: "POST",
    ...(body
      ? { headers: { "Content-Type": "application/json" }, body }
      : {}),
  });
  return handle(res);
}

/** 「接入 Git」结果：非 Git 的本地语义库接管一个已有远程仓库 */
export interface GitAdoptResult {
  ok: boolean;
  /** ok=false 时的业务码：local_content=本地有自建内容需确认 */
  code?: "local_content" | string;
  project?: SemanticProject;
  /** ok=false 时列出本地自建文件（确认勾选要展示） */
  local_files?: string[];
  /** 本地内容非空时保留的备份目录（可据此找回） */
  backup_dir?: string;
  build_note?: string;
  mcp?: { started?: string[]; error?: string };
  warnings?: string[];
  error?: string;
}

/**
 * 把已有本地语义库接管到远程仓库（备份本地 → 干净 clone → 构建）。
 * 本地有自建内容且未传 discardLocal 时后端回 200 + ok:false/code:"local_content"，
 * 不带任何文件改动；用户确认后再带 discardLocal=true 重发（本地内容备份后不删）。
 */
export async function adoptSemanticFromGit(
  name: string,
  payload: {
    repo_url: string;
    ref?: string;
    discard_local?: boolean;
    build?: boolean;
    target_db?: string;
  }
): Promise<GitAdoptResult> {
  const res = await authFetch(
    `${apiBase()}/api/wren-projects/${encodeURIComponent(name)}/git-adopt`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }
  );
  return handle(res);
}

/** 后端推送 git 所用的 SSH 公钥（账号级，配一次到 GitLab 可推所有仓库） */
export async function getGitSshKey(): Promise<{
  ok: boolean;
  pubkey?: string;
  path?: string;
  error?: string;
}> {
  const res = await authFetch(`${apiBase()}/api/git-ssh-key`, { cache: "no-store" });
  return handle(res);
}

// ── 其他操作 ─────────────────────────────────────────────────

export async function deleteSemanticProject(
  name: string
): Promise<{ ok: boolean }> {
  const res = await authFetch(`${apiBase()}/api/wren-projects/${encodeURIComponent(name)}`, {
    method: "DELETE",
  });
  return handle(res);
}

export async function buildSemanticProject(
  name: string
): Promise<{ ok: boolean; message: string }> {
  const res = await authFetch(`${apiBase()}/api/wren-projects/${encodeURIComponent(name)}/build`, {
    method: "POST",
  });
  return handle(res);
}

export async function validateSemanticProject(
  name: string
): Promise<{ ok: boolean; message: string; summary: Record<string, unknown> }> {
  const res = await authFetch(
    `${apiBase()}/api/wren-projects/${encodeURIComponent(name)}/validate`,
    { method: "POST" }
  );
  return handle(res);
}

export async function associateLocalProject(
  path: string,
  targetDb: string
): Promise<{ ok: boolean; project?: SemanticProject }> {
  const res = await authFetch(`${apiBase()}/api/wren-projects/local`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, target_db: targetDb }),
  });
  return handle(res);
}

export async function importSemanticFromGit(payload: {
  repo_url: string;
  ref?: string;
  project_name?: string;
  target_db?: string;
  overwrite_connection?: boolean;
  /** 同名本地语义库已存在时，确认用仓库内容替换它（本地内容会备份） */
  replace_existing?: boolean;
}): Promise<{
  ok: boolean;
  /** ok=false 时的业务码：exists=同名本地语义库已存在，需确认替换 */
  code?: "exists" | string;
  /** code="exists" 时提示可接管；false 表示不能接管（例如已是 Git 仓库） */
  adoptable?: boolean;
  /** code="exists" 时列出会被替换掉的本地自建文件 */
  local_files?: string[];
  pristine?: boolean;
  project?: SemanticProject;
  build_note?: string;
  error?: string;
}> {
  const res = await authFetch(`${apiBase()}/api/wren-projects/from-git`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return handle(res);
}

export async function openProjectDirectory(
  name: string
): Promise<{ ok: boolean; path?: string; error?: string }> {
  const res = await authFetch(
    `${apiBase()}/api/wren-projects/${encodeURIComponent(name)}/open-directory`,
    { method: "POST" }
  );
  return handle(res);
}
