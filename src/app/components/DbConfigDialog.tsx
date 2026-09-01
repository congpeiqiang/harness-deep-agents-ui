"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  deleteDatabase,
  listDatabases,
  listWrenProjects,
  testDatabase,
  upsertDatabase,
  DB_TYPE_OPTIONS,
  type DbInfo,
  type DbUpsertPayload,
  type WrenProjectInfo,
} from "@/lib/dbConfig";
import {
  listSemanticProjects,
  type SemanticProject,
} from "@/lib/semanticApi";
import { WorkspaceBadge } from "./WorkspaceBadge";
import { KnowledgeEditor } from "./KnowledgeEditor";

interface DbConfigPanelProps {
  // 是否可见/激活：true 时刷新列表并重置表单
  active?: boolean;
  onChanged?: () => void; // 配置变更后通知（如刷新下拉列表）
}

interface FormState extends DbUpsertPayload {}

// Radix Select 禁止 SelectItem 空字符串 value（会报
// "A <Select.Item /> must have a value prop that is not an empty string"），
// 用哨兵值代表「未配置 wren_project」，选中时映射回空串。
const NONE_SENTINEL = "__no_wren_project__";

const EMPTY_FORM: FormState = {
  name: "",
  db_type: "mysql",
  host: "",
  port: 3306,
  database: "",
  user: "",
  password: "",
  wren_project: "",
};

const typeLabel = (t: string): string => (t || "mysql").toUpperCase();

/**
 * 数据库配置管理内容（不含 Dialog 外壳），供设置页「数据库」选项卡内嵌复用。
 */
export function DbConfigPanel({ active = true, onChanged }: DbConfigPanelProps) {
  const [dbs, setDbs] = useState<DbInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [editing, setEditing] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [formExpanded, setFormExpanded] = useState(false);
  const [wrenProjects, setWrenProjects] = useState<WrenProjectInfo[]>([]);
  const [semanticProjects, setSemanticProjects] = useState<SemanticProject[]>([]);
  const [editingSemanticFor, setEditingSemanticFor] = useState<string | null>(null); // db name
  const formRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setDbs(await listDatabases());
    } catch (e) {
      setError(`加载数据库列表失败: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshWrenProjects = useCallback(async () => {
    try {
      setWrenProjects(await listWrenProjects());
    } catch (e) {
      console.error("[DB_DIALOG] 加载 Wren 项目列表失败:", e);
      setWrenProjects([]);
    }
  }, []);

  const refreshSemanticProjects = useCallback(async () => {
    try {
      setSemanticProjects(await listSemanticProjects());
    } catch {
      setSemanticProjects([]);
    }
  }, []);

  // 首次挂载时拉取；面板始终挂载（CSS hidden 切换），不再依赖 active 重复拉取
  const fetchedRef = useRef(false);
  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;
    refresh();
    refreshWrenProjects();
    refreshSemanticProjects();
  }, [refresh, refreshWrenProjects, refreshSemanticProjects]);

  // 工作区切换时重新拉取数据库列表和 Wren 项目列表
  useEffect(() => {
    const onWsChanged = () => {
      refresh();
      refreshWrenProjects();
      refreshSemanticProjects();
    };
    window.addEventListener("workspace-changed", onWsChanged);
    return () => window.removeEventListener("workspace-changed", onWsChanged);
  }, [refresh, refreshWrenProjects, refreshSemanticProjects]);

  // 语义库变更时刷新关联状态（创建/构建/删除/推送后）
  useEffect(() => {
    const onSemanticChanged = () => refreshSemanticProjects();
    window.addEventListener("semantic-projects-changed", onSemanticChanged);
    return () => window.removeEventListener("semantic-projects-changed", onSemanticChanged);
  }, [refreshSemanticProjects]);

  // active 变化时仅重置表单态，不重新拉取列表
  useEffect(() => {
    setEditing(false);
    setForm(EMPTY_FORM);
    setTestResult(null);
    setFormExpanded(false);
  }, [active]);

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setEditing(false);
    setTestResult(null);
    setFormExpanded(false);
  };

  const startEdit = (d: DbInfo) => {
    setEditing(true);
    setFormExpanded(true);
    setForm({
      name: d.name,
      db_type: d.db_type || "mysql",
      host: d.host || "",
      port: d.port || 3306,
      database: d.database || "",
      user: d.user || "",
      password: "", // 编辑时留空表示保留原密码
      wren_project: d.wren_project || "",
    });
    setTestResult(null);
    setTimeout(() => formRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
  };

  const runTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const payload = editing && !form.password ? undefined : form;
      const r = await testDatabase(form.name, payload);
      setTestResult(r);
    } catch (e) {
      setTestResult({ ok: false, message: (e as Error).message });
    } finally {
      setTesting(false);
    }
  };

  const save = async () => {
    setError(null);
    try {
      await upsertDatabase(form);
      resetForm();
      onChanged?.();
      await refresh();
    } catch (e) {
      setError(`保存失败: ${(e as Error).message}`);
    }
  };

  /** 查找数据库关联的语义库 */
  const findSemanticForDb = (dbName: string): SemanticProject | undefined => {
    return semanticProjects.find((sp) => sp.associated_dbs.includes(dbName));
  };

  const remove = async (name: string) => {
    const linked = findSemanticForDb(name);
    const msg = linked
      ? `确认删除数据库「${name}」？\n\n⚠️ 该库关联语义库「${linked.project_name}」，删除后语义库将失去关联（语义库文件不会被删除）。`
      : `确认删除数据库「${name}」？`;
    if (!window.confirm(msg)) return;
    setError(null);
    try {
      await deleteDatabase(name);
      onChanged?.();
      await refresh();
      await refreshSemanticProjects();
    } catch (e) {
      setError(`删除失败: ${(e as Error).message}`);
    }
  };

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          配置要接入的数据库（MySQL / ClickHouse / PostgreSQL）。连接信息只保存在后端，密码加密存储。
        </p>
        <div className="flex items-center gap-2">
          <WorkspaceBadge />
          <Button size="sm" onClick={() => { resetForm(); setFormExpanded(true); setTimeout(() => formRef.current?.scrollIntoView({ behavior: "smooth" }), 50); }}>+ 新增</Button>
        </div>
      </div>

      {error && (
        <div className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}

      {/* 数据库卡片列表 */}
      <div className="flex flex-col gap-2">
        {loading && dbs.length === 0 ? (
          <div className="p-3 text-xs text-muted-foreground">加载中...</div>
        ) : dbs.length === 0 ? (
          <div className="p-3 text-xs text-muted-foreground">暂无配置的数据库，点击右上角「+ 新增」添加。</div>
        ) : (
          dbs.map((d) => {
            const linked = findSemanticForDb(d.name);
            return (
              <div key={d.name} className="rounded-lg border bg-card">
                <div className="p-3">
                  {/* 头部：名称 + 类型 + 操作 */}
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold">📊 {d.name}</span>
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                          {typeLabel(d.db_type)}
                        </span>
                        {d.semantic ? (
                          <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">语义层</span>
                        ) : (
                          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">直连</span>
                        )}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {d.host || "-"}:{d.port}/{d.database || "-"}
                      </div>
                    </div>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => startEdit(d)}
                      >
                        编辑
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs text-destructive hover:text-destructive"
                        onClick={() => remove(d.name)}
                      >
                        删除
                      </Button>
                    </div>
                  </div>

                  {/* 语义层状态区域 */}
                  <div className="mt-2 rounded bg-muted/30 p-2">
                    <div className="text-[10px] font-medium text-muted-foreground mb-1">── 语义层 ──</div>
                    {linked ? (
                      <div>
                        <div className="flex items-center gap-2 text-xs">
                          <span className="text-emerald-600">✅ {linked.project_name}</span>
                          <span className="text-muted-foreground">
                            模型: {linked.models} | 关系: {linked.relationships}
                          </span>
                          <span
                            className={
                              linked.built
                                ? "rounded bg-emerald-500/10 px-1 py-0.5 text-[10px] text-emerald-600"
                                : "rounded bg-amber-500/10 px-1 py-0.5 text-[10px] text-amber-600"
                            }
                          >
                            {linked.built ? "已构建" : "未构建"}
                          </span>
                        </div>
                        <div className="mt-1.5 flex gap-1.5">
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-6 text-[10px]"
                            onClick={() =>
                              setEditingSemanticFor(
                                editingSemanticFor === d.name ? null : d.name
                              )
                            }
                          >
                            📝 编辑知识
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-6 text-[10px]"
                            onClick={async () => {
                              try {
                                const { buildSemanticProject } = await import("@/lib/semanticApi");
                                const r = await buildSemanticProject(linked.name);
                                alert(r.message);
                                await refreshSemanticProjects();
                              } catch (e) {
                                setError(`构建失败: ${(e as Error).message}`);
                              }
                            }}
                          >
                            🔨 构建
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-amber-600">⚠️ 未建模</span>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-6 text-[10px]"
                          onClick={() => {
                            // 通知语义库面板打开创建对话框，并切换到语义库 tab
                            window.dispatchEvent(
                              new CustomEvent("create-semantic-for-db", {
                                detail: { dbName: d.name },
                              })
                            );
                            window.dispatchEvent(
                              new CustomEvent("switch-settings-tab", {
                                detail: { tab: "semantic" },
                              })
                            );
                          }}
                        >
                          ✨ 创建语义库
                        </Button>
                      </div>
                    )}
                  </div>
                </div>

                {/* 内嵌知识编辑器 */}
                {editingSemanticFor === d.name && linked && (
                  <div className="border-t p-3">
                    <KnowledgeEditor
                      projectName={linked.name}
                      onClose={() => setEditingSemanticFor(null)}
                      onSaved={() => refreshSemanticProjects()}
                    />
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* 新增/编辑表单 */}
      {formExpanded && (
        <div ref={formRef} className="rounded-md border p-3 grid gap-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold">
              {editing ? `编辑「${form.name}」` : "新增数据库"}
            </span>
            <Button variant="ghost" size="sm" onClick={resetForm}>
              取消
            </Button>
          </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label>名称（db_name）</Label>
                <Input
                  value={form.name}
                  onChange={(e) => set("name", e.target.value)}
                  placeholder="如 生产MySQL / 分析ClickHouse"
                />
              </div>
              <div className="grid gap-1.5">
                <Label>类型</Label>
                <Select
                  value={form.db_type}
                  onValueChange={(v) => set("db_type", v)}
                >
                  <SelectTrigger className="h-9 text-xs">
                    <SelectValue placeholder="选择数据库类型" />
                  </SelectTrigger>
                  <SelectContent>
                    {DB_TYPE_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label>Host</Label>
                <Input
                  value={form.host}
                  onChange={(e) => set("host", e.target.value)}
                  placeholder="如 mysql-master / 192.168.1.10"
                />
              </div>
              <div className="grid gap-1.5">
                <Label>Port</Label>
                <Input
                  type="number"
                  value={form.port}
                  onChange={(e) => set("port", Number(e.target.value) || 3306)}
                />
              </div>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label>数据库名</Label>
                <Input
                  value={form.database}
                  onChange={(e) => set("database", e.target.value)}
                  placeholder="物理库名"
                />
              </div>
              <div className="grid gap-1.5">
                <Label>用户名</Label>
                <Input
                  value={form.user}
                  onChange={(e) => set("user", e.target.value)}
                  placeholder="如 aoi-dev / default"
                />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label>密码 {editing && <span className="text-muted-foreground">（留空保留原密码）</span>}</Label>
              <Input
                type="password"
                value={form.password || ""}
                onChange={(e) => set("password", e.target.value)}
                placeholder="••••••••"
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Wren 项目（语义层）</Label>
              <Select
                value={form.wren_project || NONE_SENTINEL}
                onValueChange={(v) => set("wren_project", v === NONE_SENTINEL ? "" : v)}
              >
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue placeholder="未配置（走直连）" />
                </SelectTrigger>
                <SelectContent>
                  {/* Radix Select 禁止 SelectItem 空字符串 value，用哨兵占位表示「未配置」 */}
                  <SelectItem value={NONE_SENTINEL}>未配置（走直连）</SelectItem>
                  {wrenProjects.map((p) => (
                    <SelectItem key={p.path} value={p.path} title={p.path}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] leading-tight text-muted-foreground">
                配置后该库走 Wren 语义层查询（工具名 wrenai_&lt;库名&gt;_*），需重启后端生效。
              </p>
            </div>

            {testResult && (
              <div
                className={`rounded-md px-3 py-2 text-xs ${
                  testResult.ok ? "bg-emerald-500/10 text-emerald-600" : "bg-destructive/10 text-destructive"
                }`}
              >
                {testResult.message}
              </div>
            )}

            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={runTest} disabled={testing || !form.name}>
                {testing ? "测试中..." : "测试连接"}
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  resetForm();
                }}
              >
                清空
              </Button>
              <Button onClick={save} disabled={!form.name || !form.host}>
                {editing ? "更新" : "新增"}
              </Button>
            </div>
        </div>
      )}
    </div>
  );
}

interface DbConfigDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged?: () => void;
}

/** 独立弹窗版（保留向后兼容；设置页已改走 DbConfigPanel 内嵌） */
export function DbConfigDialog({ open, onOpenChange, onChanged }: DbConfigDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle>数据库配置管理</DialogTitle>
          <DialogDescription>配置要接入的数据库。</DialogDescription>
        </DialogHeader>
        <DbConfigPanel active={open} onChanged={onChanged} />
      </DialogContent>
    </Dialog>
  );
}
