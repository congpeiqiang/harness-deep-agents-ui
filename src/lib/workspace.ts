// 工作区管理 API 客户端（后端 workspace API 已合并进 langgraph API）
// 与聊天同源同端口，地址直接复用配置中的 deploymentUrl（默认 localhost:2026）。
import { getConfig } from "@/lib/config";

export interface WorkspaceInfo {
  name_key: string; // 注册键（如 "default"、"project-a"）
  name: string; // 显示名称
  path: string;
  created_at: string;
  active: boolean;
}

export interface WorkspaceActiveInfo {
  active: string;
  path: string;
  checkpoint_dir: string;
  feedback_dir: string;
  report_dir: string;
  semantic_dir: string;
}

export interface WorkspaceListResult {
  workspaces: WorkspaceInfo[];
  active: string;
}

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
      if (j?.error) msg = j.error;
    } catch {
      // ignore
    }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

/** 获取工作区列表 */
export async function listWorkspaces(): Promise<WorkspaceListResult> {
  const res = await fetch(`${apiBase()}/api/workspaces`, { cache: "no-store" });
  return handle<WorkspaceListResult>(res);
}

/** 注册新工作区 */
export async function registerWorkspace(
  name: string,
  path: string,
  displayName?: string
): Promise<{ ok: boolean; workspace: WorkspaceInfo; requires_restart: boolean }> {
  const res = await fetch(`${apiBase()}/api/workspaces`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, path, display_name: displayName }),
  });
  return handle(res);
}

/** 激活工作区 */
export async function activateWorkspace(
  name: string
): Promise<{ ok: boolean; active: string; requires_restart: boolean }> {
  const res = await fetch(`${apiBase()}/api/workspaces/${encodeURIComponent(name)}/activate`, {
    method: "PUT",
  });
  return handle(res);
}

/** 取消注册工作区 */
export async function unregisterWorkspace(
  name: string
): Promise<{ ok: boolean; name: string; requires_restart: boolean }> {
  const res = await fetch(`${apiBase()}/api/workspaces/${encodeURIComponent(name)}`, {
    method: "DELETE",
  });
  return handle(res);
}

/** 获取当前活跃工作区信息 */
export async function getActiveWorkspace(): Promise<WorkspaceActiveInfo> {
  const res = await fetch(`${apiBase()}/api/workspaces/active`, { cache: "no-store" });
  return handle<WorkspaceActiveInfo>(res);
}