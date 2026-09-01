// 数据库配置管理 API 客户端（后端 db-config API 已合并进 langgraph API）
// 与聊天同源同端口，地址直接复用配置中的 deploymentUrl（默认 localhost:2026）。
import { getConfig } from "@/lib/config";

export interface DbInfo {
  name: string;
  db_type: string;
  host: string;
  port: number;
  database: string;
  user: string;
  password?: string;
  password_configured?: boolean;
  semantic?: boolean; // 是否已在 Wren 语义层建模
  wren_project?: string; // 关联的 Wren 项目绝对路径（空=未配置，走直连）
  extra_config?: Record<string, unknown>;
}

export interface DbUpsertPayload {
  name: string;
  db_type: string;
  host: string;
  port: number;
  database: string;
  user: string;
  password?: string;
  wren_project?: string;
  extra_config?: Record<string, unknown>;
}

export interface WrenProjectInfo {
  path: string;
  name: string;
}

// ── 语义库管理（wren-semantic API）─────────────────────────
export interface WrenGitInfo {
  remote: string;
  branch: string;
  commit: string;
  tag: string;
}

export interface WrenSemanticProject {
  path: string;
  name: string; // 目录名
  project_name: string; // wren_project.yml 的 name
  source: "local" | "git";
  git: WrenGitInfo | null;
  built: boolean; // target/mdl.json 是否已构建
  models: number;
  views: number;
  relationships: number;
  cubes: number;
  data_source?: string;
  associated_dbs: string[]; // 关联该语义库的数据库配置 name
}

export interface FromGitPayload {
  repo_url: string;
  ref?: string;
  project_name?: string;
  target_db?: string;
  overwrite_connection?: boolean; // 默认 true：用目标库连接覆盖仓库凭据
}

export interface FromGitResult {
  ok: boolean;
  project?: WrenSemanticProject;
  build_note?: string;
  requires_restart?: boolean;
  error?: string;
}

const apiBase = (): string => {
  // 复用已保存的部署地址（chat 与 db-config 现为同一后端/端口 2026）。
  // 未配置时回退 localhost:2026；去掉尾部斜杠避免拼接出 //。
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

export async function listDatabases(): Promise<DbInfo[]> {
  const res = await fetch(`${apiBase()}/api/db-configs`, { cache: "no-store" });
  const j = await handle<{ databases: DbInfo[] }>(res);
  return j.databases || [];
}

export async function upsertDatabase(payload: DbUpsertPayload): Promise<{ ok: boolean }> {
  const res = await fetch(`${apiBase()}/api/db-configs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return handle(res);
}

export async function deleteDatabase(name: string): Promise<{ ok: boolean }> {
  const res = await fetch(`${apiBase()}/api/db-configs/${encodeURIComponent(name)}`, {
    method: "DELETE",
  });
  return handle(res);
}

export async function listWrenProjects(): Promise<WrenProjectInfo[]> {
  const res = await fetch(`${apiBase()}/api/wren-projects`, { cache: "no-store" });
  const j = await handle<{ projects: WrenProjectInfo[] }>(res);
  return j.projects || [];
}

// ── 语义库管理 API ───────────────────────────────────────
export async function listSemanticProjects(): Promise<WrenSemanticProject[]> {
  const res = await fetch(`${apiBase()}/api/wren-projects`, { cache: "no-store" });
  const j = await handle<{ projects: WrenSemanticProject[] }>(res);
  return j.projects || [];
}

export async function associateLocalProject(
  path: string,
  targetDb: string
): Promise<{ ok: boolean; requires_restart?: boolean }> {
  const res = await fetch(`${apiBase()}/api/wren-projects/local`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, target_db: targetDb }),
  });
  return handle(res);
}

export async function importSemanticFromGit(
  payload: FromGitPayload
): Promise<FromGitResult> {
  const res = await fetch(`${apiBase()}/api/wren-projects/from-git`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  // 后端失败时也返回 {error} 结构，统一走 handle 抛错，此处直接 parse 到 ok:false
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const j = await res.json();
      msg = j.error || msg;
    } catch {
      /* ignore */
    }
    return { ok: false, error: msg };
  }
  return res.json() as Promise<FromGitResult>;
}

export async function deleteSemanticProject(
  name: string
): Promise<{ ok: boolean; requires_restart?: boolean }> {
  const res = await fetch(`${apiBase()}/api/wren-projects/${encodeURIComponent(name)}`, {
    method: "DELETE",
  });
  return handle(res);
}

export async function buildSemanticProject(
  name: string
): Promise<{ ok: boolean; message: string }> {
  const res = await fetch(
    `${apiBase()}/api/wren-projects/${encodeURIComponent(name)}/build`,
    { method: "POST" }
  );
  const j = await res.json().catch(() => ({ ok: false, message: `HTTP ${res.status}` }));
  return j as { ok: boolean; message: string };
}

export interface WrenValidateResult {
  ok: boolean;
  message: string;
  summary: WrenSemanticSummary;
}

export async function validateSemanticProject(name: string): Promise<WrenValidateResult> {
  const res = await fetch(
    `${apiBase()}/api/wren-projects/${encodeURIComponent(name)}/validate`,
    { method: "POST" }
  );
  const j = await res.json().catch(() => ({
    ok: false,
    message: `HTTP ${res.status}`,
    summary: { name, path: "", built: false, models: 0, views: 0, relationships: 0, cubes: 0, associated_dbs: [] },
  }));
  return j as WrenValidateResult;
}

export interface WrenSemanticSummary {
  name: string;
  path: string;
  built: boolean;
  models: number;
  views: number;
  relationships: number;
  cubes: number;
  data_source?: string;
  associated_dbs: string[];
}

export async function getSemanticSummary(name: string): Promise<WrenSemanticSummary> {
  const res = await fetch(
    `${apiBase()}/api/wren-projects/${encodeURIComponent(name)}/summary`,
    { cache: "no-store" }
  );
  const j = await handle<{ summary: WrenSemanticSummary }>(res);
  return j.summary;
}

// ── 新建语义库 API ─────────────────────────────────────────
export interface CreateProjectPayload {
  project_name: string;
  db_name: string;
  description?: string;
}

export interface CreateProjectResult {
  ok: boolean;
  project?: WrenSemanticProject;
  path?: string;
  error?: string;
}

export interface IntrospectTableColumn {
  name: string;
  type: string;
  wren_type: string;
  nullable: boolean;
  comment: string;
  is_primary_key: boolean;
}

export interface IntrospectTable {
  name: string;
  comment: string;
  columns: IntrospectTableColumn[];
  primary_key: string | null;
  column_count: number;
}

export interface IntrospectForeignKey {
  source_table: string;
  source_column: string;
  target_table: string;
  target_column: string;
}

export interface IntrospectResult {
  ok: boolean;
  db_name?: string;
  db_type?: string;
  tables: IntrospectTable[];
  foreign_keys: IntrospectForeignKey[];
  error?: string;
}

export interface GenerateModelsPayload {
  selected_tables: string[];
  include_relationships?: boolean;
  db_name?: string;
}

export interface GenerateModelsResult {
  ok: boolean;
  generated: { models: number; relationships: number };
  error?: string;
}

export interface PushToGitPayload {
  remote_url: string;
  branch?: string;
  tag?: string;
  commit_message?: string;
}

export interface PushToGitResult {
  ok: boolean;
  message: string;
  error?: string;
}

export async function createSemanticProject(
  payload: CreateProjectPayload
): Promise<CreateProjectResult> {
  const res = await fetch(`${apiBase()}/api/wren-projects/create`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const j = await res.json();
      msg = j.error || msg;
    } catch { /* ignore */ }
    return { ok: false, error: msg };
  }
  return res.json() as Promise<CreateProjectResult>;
}

export async function introspectTables(
  projectName: string,
  dbName?: string
): Promise<IntrospectResult> {
  const res = await fetch(
    `${apiBase()}/api/wren-projects/${encodeURIComponent(projectName)}/introspect`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ db_name: dbName || "" }),
    }
  );
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const j = await res.json();
      msg = j.error || msg;
    } catch { /* ignore */ }
    return { ok: false, tables: [], foreign_keys: [], error: msg };
  }
  return res.json() as Promise<IntrospectResult>;
}

export async function generateModels(
  projectName: string,
  payload: GenerateModelsPayload
): Promise<GenerateModelsResult> {
  const res = await fetch(
    `${apiBase()}/api/wren-projects/${encodeURIComponent(projectName)}/generate-models`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }
  );
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const j = await res.json();
      msg = j.error || msg;
    } catch { /* ignore */ }
    return { ok: false, generated: { models: 0, relationships: 0 }, error: msg };
  }
  return res.json() as Promise<GenerateModelsResult>;
}

export async function getKnowledgeTemplates(
  projectName: string
): Promise<{ templates: Record<string, string> }> {
  const res = await fetch(
    `${apiBase()}/api/wren-projects/${encodeURIComponent(projectName)}/knowledge/template`,
    { cache: "no-store" }
  );
  return handle<{ templates: Record<string, string> }>(res);
}

export async function saveKnowledge(
  projectName: string,
  files: Record<string, string>
): Promise<{ ok: boolean; saved: string[]; error?: string }> {
  const res = await fetch(
    `${apiBase()}/api/wren-projects/${encodeURIComponent(projectName)}/knowledge/save`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ files }),
    }
  );
  return handle(res);
}

export async function openProjectDirectory(
  projectName: string
): Promise<{ ok: boolean; path: string; error?: string }> {
  const res = await fetch(
    `${apiBase()}/api/wren-projects/${encodeURIComponent(projectName)}/open-directory`,
    { method: "POST" }
  );
  return handle(res);
}

export async function pushToGit(
  projectName: string,
  payload: PushToGitPayload
): Promise<PushToGitResult> {
  const res = await fetch(
    `${apiBase()}/api/wren-projects/${encodeURIComponent(projectName)}/push`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }
  );
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const j = await res.json();
      msg = j.error || msg;
    } catch { /* ignore */ }
    return { ok: false, message: msg, error: msg };
  }
  return res.json() as Promise<PushToGitResult>;
}

export async function testDatabase(
  name: string,
  payload?: DbUpsertPayload
): Promise<{ ok: boolean; message: string }> {
  const res = await fetch(`${apiBase()}/api/db-configs/${encodeURIComponent(name)}/test`, {
    method: "POST",
    headers: payload ? { "Content-Type": "application/json" } : undefined,
    body: payload ? JSON.stringify(payload) : undefined,
  });
  // 测试失败时后端返回 400 + {ok:false,message}，仍要解析出 message
  const j = await res.json().catch(() => ({ ok: false, message: `HTTP ${res.status}` }));
  return j as { ok: boolean; message: string };
}

export const DB_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: "mysql", label: "MySQL" },
  { value: "clickhouse", label: "ClickHouse" },
  { value: "postgres", label: "PostgreSQL" },
];
