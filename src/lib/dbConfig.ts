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
