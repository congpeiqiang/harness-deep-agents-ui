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
}

// 业务知识结构化类型
export interface GlossaryTerm {
  name: string;
  definition: string;
  synonyms: string[];
  related_tables: string[];
}

export interface Metric {
  name: string;
  display_name: string;
  type: "sum" | "count" | "count_distinct" | "avg" | "max" | "min";
  expression: string;
  dimensions?: string[];
  description?: string;
}

export interface Rule {
  name: string;
  category: "general" | "filter" | "calculation" | "permission";
  description: string;
  scope: "global" | "tables";
  tables?: string[];
  file?: string;
}

export interface SqlPattern {
  name: string;
  questions: string[];
  template: string;
  parameters?: { name: string; type: string; default: string }[];
  file?: string;
}

export interface Caveat {
  title: string;
  severity: "important" | "normal" | "tip";
  description: string;
  correct_example?: string;
  wrong_example?: string;
}

export interface KnowledgeData {
  glossary: GlossaryTerm[];
  metrics: Metric[];
  rules: Rule[];
  sql_patterns: SqlPattern[];
  caveats: Caveat[];
}

export interface GitStatusInfo {
  ok: boolean;
  is_git: boolean;
  has_updates: boolean;
  has_local_changes: boolean;
  branch: string;
}

// ── API 基础 ─────────────────────────────────────────────────

const apiBase = (): string => {
  const cfg = getConfig();
  const base = cfg?.deploymentUrl || "http://localhost:2026";
  return base.replace(/\/+$/, "");
};

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
  const res = await fetch(`${apiBase()}/api/db-configs`, { cache: "no-store" });
  const j = await handle<{ databases: DbInfo[] }>(res);
  return j.databases || [];
}

// ── 语义库列表 ───────────────────────────────────────────────

export async function listSemanticProjects(): Promise<SemanticProject[]> {
  const res = await fetch(`${apiBase()}/api/wren-projects`, { cache: "no-store" });
  const j = await handle<{ projects: SemanticProject[] }>(res);
  return j.projects || [];
}

// ── 新建语义库 ───────────────────────────────────────────────

export async function createSemanticProject(
  payload: CreateProjectPayload
): Promise<{ ok: boolean; project?: SemanticProject; path?: string; error?: string }> {
  const res = await fetch(`${apiBase()}/api/wren-projects/create`, {
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
  const res = await fetch(`${apiBase()}/api/wren-projects/${encodeURIComponent(name)}/introspect`, {
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
  const res = await fetch(
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
  const res = await fetch(
    `${apiBase()}/api/wren-projects/${encodeURIComponent(name)}/knowledge/read`,
    { cache: "no-store" }
  );
  return handle(res);
}

export async function saveKnowledge(
  name: string,
  files: Record<string, string>
): Promise<{ ok: boolean; saved: string[] }> {
  const res = await fetch(
    `${apiBase()}/api/wren-projects/${encodeURIComponent(name)}/knowledge/save`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ files }),
    }
  );
  return handle(res);
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
  generated: Partial<KnowledgeData>;
  mode: "ai" | "fallback";
  error?: string;
}> {
  const res = await fetch(
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
  const res = await fetch(
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
  const res = await fetch(`${apiBase()}/api/wren-projects/${encodeURIComponent(name)}/push`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return handle(res);
}

export async function getGitStatus(name: string): Promise<GitStatusInfo> {
  const res = await fetch(
    `${apiBase()}/api/wren-projects/${encodeURIComponent(name)}/git-status`,
    { cache: "no-store" }
  );
  return handle(res);
}

export async function gitPull(
  name: string
): Promise<{ ok: boolean; message?: string; error?: string }> {
  const res = await fetch(`${apiBase()}/api/wren-projects/${encodeURIComponent(name)}/git-pull`, {
    method: "POST",
  });
  return handle(res);
}

// ── 其他操作 ─────────────────────────────────────────────────

export async function deleteSemanticProject(
  name: string
): Promise<{ ok: boolean }> {
  const res = await fetch(`${apiBase()}/api/wren-projects/${encodeURIComponent(name)}`, {
    method: "DELETE",
  });
  return handle(res);
}

export async function buildSemanticProject(
  name: string
): Promise<{ ok: boolean; message: string }> {
  const res = await fetch(`${apiBase()}/api/wren-projects/${encodeURIComponent(name)}/build`, {
    method: "POST",
  });
  return handle(res);
}

export async function validateSemanticProject(
  name: string
): Promise<{ ok: boolean; message: string; summary: Record<string, unknown> }> {
  const res = await fetch(
    `${apiBase()}/api/wren-projects/${encodeURIComponent(name)}/validate`,
    { method: "POST" }
  );
  return handle(res);
}

export async function associateLocalProject(
  path: string,
  targetDb: string
): Promise<{ ok: boolean; project?: SemanticProject }> {
  const res = await fetch(`${apiBase()}/api/wren-projects/local`, {
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
}): Promise<{
  ok: boolean;
  project?: SemanticProject;
  build_note?: string;
  error?: string;
}> {
  const res = await fetch(`${apiBase()}/api/wren-projects/from-git`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return handle(res);
}

export async function openProjectDirectory(
  name: string
): Promise<{ ok: boolean; path?: string; error?: string }> {
  const res = await fetch(
    `${apiBase()}/api/wren-projects/${encodeURIComponent(name)}/open-directory`,
    { method: "POST" }
  );
  return handle(res);
}
