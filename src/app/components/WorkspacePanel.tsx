"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { AlertTriangle, Check, FolderOpen, RefreshCw, Trash2 } from "lucide-react";
import { WorkspaceBadge } from "./WorkspaceBadge";
import {
  listWorkspaces,
  registerWorkspace,
  activateWorkspace,
  unregisterWorkspace,
  type WorkspaceInfo,
} from "@/lib/workspace";

interface WorkspacePanelProps {
  active?: boolean;
  onChanged?: () => void;
}

interface NewForm {
  name: string;
  path: string;
  display_name: string;
}

const EMPTY_FORM: NewForm = { name: "", path: "", display_name: "" };

export function WorkspacePanel({ active = true, onChanged }: WorkspacePanelProps) {
  const [workspaces, setWorkspaces] = useState<WorkspaceInfo[]>([]);
  const [activeName, setActiveName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState<NewForm>(EMPTY_FORM);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listWorkspaces();
      setWorkspaces(data.workspaces);
      setActiveName(data.active);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (active) refresh();
  }, [active, refresh]);

  // 外部切换工作区（输入区下拉框 / 其它面板）后同步刷新：
  // 它们会 dispatch workspace-changed，本面板若不监听会一直显示旧激活态。
  useEffect(() => {
    const onWsChanged = () => refresh();
    window.addEventListener("workspace-changed", onWsChanged);
    return () => window.removeEventListener("workspace-changed", onWsChanged);
  }, [refresh]);

  const clearNotice = () => {
    if (notice) setNotice(null);
  };

  const handleRegister = async () => {
    const name = form.name.trim();
    const path = form.path.trim();
    const displayName = form.display_name.trim();
    if (!name || !path) {
      setError("名称和路径必填");
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await registerWorkspace(name, path, displayName || undefined);
      setForm(EMPTY_FORM);
      setShowNew(false);
      setNotice("工作区已注册，可立即切换使用。");
      await refresh();
      onChanged?.();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "注册失败");
    } finally {
      setBusy(false);
    }
  };

  const handleActivate = async (nameKey: string) => {
    if (nameKey === activeName) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await activateWorkspace(nameKey);
      setNotice(`已切换到「${nameKey}」。`);
      await refresh();
      onChanged?.();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "切换失败");
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (nameKey: string) => {
    if (nameKey === "default") {
      setError("默认工作区不可删除");
      return;
    }
    if (!confirm(`确定取消注册工作区「${nameKey}」？不会删除服务器上的文件。`)) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await unregisterWorkspace(nameKey);
      setNotice("工作区已取消注册。");
      await refresh();
      onChanged?.();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "删除失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3" onClick={clearNotice}>
      {/* 头部 */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground leading-relaxed">
          工作区用于隔离不同项目的数据库配置、语义库、对话历史和报告。切换即时生效，共享技能和记忆。
        </p>
        <div className="flex items-center gap-2">
          <WorkspaceBadge />
          <Button
            variant="ghost"
            size="sm"
            onClick={refresh}
            disabled={loading || busy}
          >
            <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
          </Button>
          <Button
            size="sm"
            onClick={() => {
              setShowNew(!showNew);
              setForm(EMPTY_FORM);
              setError(null);
            }}
            disabled={busy}
          >
            + 新增
          </Button>
        </div>
      </div>

      {/* 概览统计 */}
      {workspaces.length > 0 && (
        <div className="flex items-center gap-4 rounded-md border bg-muted/30 px-3 py-2 text-xs">
          <span>
            全部: <strong>{workspaces.length}</strong>
          </span>
          <span className="text-emerald-600">
            活跃: <strong>{workspaces.filter((w) => w.name_key === activeName).length}</strong>
          </span>
          <span className="ml-auto text-muted-foreground">
            💡 点击「激活」切换工作区，数据查询结果互不干扰
          </span>
        </div>
      )}

      {/* 错误 / 提示 */}
      {error && (
        <div className="flex items-start gap-2 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <AlertTriangle className="size-3.5 shrink-0 mt-0.5" />
          {error}
        </div>
      )}
      {notice && (
        <div className="flex items-start gap-2 rounded-md bg-emerald-50 dark:bg-emerald-950/30 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-300">
          <Check className="size-3.5 shrink-0 mt-0.5" />
          {notice}
        </div>
      )}

      {/* 新增表单 */}
      {showNew && (
        <div className="rounded-md border border-border bg-muted/30 p-3 space-y-3">
          <div className="grid gap-1.5">
            <Label className="text-xs">
              名称标识 <span className="text-destructive">*</span>
            </Label>
            <Input
              className="h-8 text-xs"
              placeholder="如 project-a（字母、数字、中文、下划线、连字符）"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              工作区的唯一标识，用于接口与内部引用，注册后不可与其他工作区重复。
            </p>
          </div>
          <div className="grid gap-1.5">
            <Label className="text-xs">显示名称</Label>
            <Input
              className="h-8 text-xs"
              placeholder="如 项目A（选填，留空则显示「名称标识」）"
              value={form.display_name}
              onChange={(e) => setForm({ ...form, display_name: e.target.value })}
            />
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              选填。仅用于界面下拉列表中的友好展示名，可含空格与任意文字。
            </p>
          </div>
          <div className="grid gap-1.5">
            <Label className="text-xs">
              工作区目录路径 <span className="text-destructive">*</span>
            </Label>
            <Input
              className="h-8 text-xs"
              placeholder="如 /app/data/my-workspace"
              value={form.path}
              onChange={(e) => setForm({ ...form, path: e.target.value })}
            />
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              服务器上的文件夹完整路径；查询结果、报告、对话历史等数据将隔离保存在此目录。路径不存在时自动创建。
            </p>
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setShowNew(false);
                setForm(EMPTY_FORM);
              }}
            >
              取消
            </Button>
            <Button size="sm" onClick={handleRegister} disabled={busy}>
              注册
            </Button>
          </div>
        </div>
      )}

      {/* 工作区列表 */}
      <div className="flex flex-col gap-2 max-h-[300px] overflow-y-auto">
        {loading && workspaces.length === 0 ? (
          <div className="py-6 text-center text-xs text-muted-foreground">加载中...</div>
        ) : workspaces.length === 0 ? (
          <div className="py-6 text-center text-xs text-muted-foreground">
            暂无工作区，点击右上角「+ 新增」注册
          </div>
        ) : (
        workspaces.map((ws) => {
          const isActive = ws.name_key === activeName;
          const isDefault = ws.name_key === "default";
          return (
            <div
              key={ws.name_key}
              className={cn(
                "flex items-center justify-between rounded-md border px-3 py-2",
                isActive
                  ? "border-primary/40 bg-primary/5"
                  : "border-border bg-background"
              )}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <FolderOpen className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="text-sm font-medium truncate">
                    {ws.name}
                  </span>
                  {isActive && (
                    <span className="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                      活跃
                    </span>
                  )}
                  {isDefault && (
                    <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                      默认
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground truncate mt-0.5">
                  {ws.path}
                </p>
              </div>
              <div className="flex shrink-0 gap-1 ml-2">
                {!isActive && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => handleActivate(ws.name_key)}
                    disabled={busy}
                  >
                    激活
                  </Button>
                )}
                {!isDefault && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs text-destructive hover:text-destructive"
                    onClick={() => handleDelete(ws.name_key)}
                    disabled={busy}
                  >
                    <Trash2 className="size-3" />
                  </Button>
                )}
              </div>
            </div>
          );
        })
        )}
      </div>
    </div>
  );
}
