/**
 * 工作区「彻底删除」API 客户端（连同服务器目录一起删除，不可恢复）。
 *
 * 独立文件原因：src/lib/workspace.ts 为 DLP 加密文件不可编辑，而其提供的
 * unregisterWorkspace 只「取消注册、不删文件」；本文件仿 semanticApi.ts 模式
 * 从加密 config（getConfig）取后端基址，直连
 *   DELETE /api/workspaces/{name}?delete_files=1
 * 后端（src/api/workspace.py + workspace_manager/manager.py）自带路径护栏：
 * 禁 default / 禁当前活跃工作区 / 禁 data_root 之外的路径 / 禁保留目录，
 * 失败返回 400 并带 error 文案。
 */
import { getConfig } from "@/lib/config";

// ── 后端基址（与 semanticApi.ts 相同的取法）────────────────

const apiBase = (): string => {
  const cfg = getConfig();
  const base = cfg?.deploymentUrl || "http://localhost:2026";
  return base.replace(/\/+$/, "");
};

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const j = (await res.json()) as { error?: string };
      if (j?.error) msg = j.error;
    } catch {
      // 非 JSON 响应体时保留 HTTP 状态文案
    }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

// ── 类型与操作 ─────────────────────────────────────────────

export interface DeleteWorkspaceResult {
  ok: boolean;
  name?: string;
  removed_dir?: string | null;
}

/**
 * 彻底删除工作区：移除注册表条目 + 删除服务器目录（语义库/报告/中间数据，不可恢复）。
 * @param name 工作区名称标识（name_key）。default 与当前活跃工作区会被后端拒绝。
 */
export async function deleteWorkspace(
  name: string
): Promise<DeleteWorkspaceResult> {
  const res = await fetch(
    `${apiBase()}/api/workspaces/${encodeURIComponent(name)}?delete_files=1`,
    { method: "DELETE" }
  );
  return handle<DeleteWorkspaceResult>(res);
}
