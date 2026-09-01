"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
import { cn } from "@/lib/utils";
import { WorkspaceBadge } from "./WorkspaceBadge";
import { KnowledgeEditor } from "./KnowledgeEditor";
import {
  listSemanticProjects,
  listDatabases,
  createSemanticProject,
  introspectTables,
  generateModels,
  deleteSemanticProject,
  buildSemanticProject,
  validateSemanticProject,
  importSemanticFromGit,
  associateLocalProject,
  pushToGit,
  getGitStatus,
  gitPull,
  openProjectDirectory,
  type SemanticProject,
  type IntrospectTable,
  type IntrospectForeignKey,
} from "@/lib/semanticApi";

interface DbInfo {
  name: string;
  db_type: string;
}

interface SemanticLibraryPanelProps {
  active?: boolean;
  onChanged?: () => void;
}

const NONE_SENTINEL = "__no_db__";

type AddMode = "ai" | "manual" | "git" | "local" | null;
type CreateStep = 1 | 2 | 3 | 4;

/**
 * Wren 语义库管理面板（UX 优化版）
 *
 * - 卡片式列表展示
 * - 统一 [+ 添加] 入口 + 引导对话框
 * - 内嵌 KnowledgeEditor 编辑业务知识
 */
export function SemanticLibraryPanel({ active = true, onChanged }: SemanticLibraryPanelProps) {
  const [projects, setProjects] = useState<SemanticProject[]>([]);
  const [dbs, setDbs] = useState<DbInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [busyOp, setBusyOp] = useState<string>("");

  // 添加对话框
  const [addMode, setAddMode] = useState<AddMode>(null);

  // 新建流程
  const [createStep, setCreateStep] = useState<CreateStep>(1);
  const [createDbName, setCreateDbName] = useState("");
  const [createName, setCreateName] = useState("");
  const [createDesc, setCreateDesc] = useState("");
  const [createdProjectName, setCreatedProjectName] = useState("");
  const [introspectData, setIntrospectData] = useState<{
    tables: IntrospectTable[];
    foreign_keys: IntrospectForeignKey[];
    db_type: string;
  } | null>(null);
  const [selectedTables, setSelectedTables] = useState<Set<string>>(new Set());

  // Git 导入
  const [gitUrl, setGitUrl] = useState("");
  const [gitRef, setGitRef] = useState("");
  const [gitProjName, setGitProjName] = useState("");
  const [gitTargetDb, setGitTargetDb] = useState("");

  // 关联本地
  const [localPath, setLocalPath] = useState("");
  const [localTargetDb, setLocalTargetDb] = useState("");

  // 推送 Git
  const [pushName, setPushName] = useState("");
  const [pushUrl, setPushUrl] = useState("");
  const [pushBranch, setPushBranch] = useState("main");
  const [pushTag, setPushTag] = useState("");

  // 知识编辑器
  const [editingProject, setEditingProject] = useState<string | null>(null);

  // ── 数据加载 ──────────────────────────────────────────────

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [ps, ds] = await Promise.all([listSemanticProjects(), listDatabases()]);
      setProjects(ps);
      setDbs(ds);
    } catch (e) {
      setError(`加载失败: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchedRef = useRef(false);
  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;
    refresh();
  }, [refresh]);

  useEffect(() => {
    const onWsChanged = () => refresh();
    window.addEventListener("workspace-changed", onWsChanged);
    return () => window.removeEventListener("workspace-changed", onWsChanged);
  }, [refresh]);

  // 监听「从数据库卡片创建语义库」事件
  useEffect(() => {
    const onCreateForDb = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      const dbName = detail?.dbName || "";
      if (dbName) {
        resetCreate();
        setCreateDbName(dbName);
        setCreateName(`${dbName}_semantic`);
        setAddMode("manual");
      }
    };
    window.addEventListener("create-semantic-for-db", onCreateForDb);
    return () => window.removeEventListener("create-semantic-for-db", onCreateForDb);
  }, []);

  useEffect(() => {
    setNotice(null);
  }, [active]);

  // ── 操作函数 ──────────────────────────────────────────────

  const runOp = async (op: string, fn: () => Promise<void>) => {
    setError(null);
    setNotice(null);
    setBusy(true);
    setBusyOp(op);
    try {
      await fn();
    } catch (e) {
      setError(`${op} 失败: ${(e as Error).message}`);
    } finally {
      setBusy(false);
      setBusyOp("");
      // 通知其他面板（如数据库面板）刷新语义库关联状态
      window.dispatchEvent(new CustomEvent("semantic-projects-changed"));
    }
  };

  const doDelete = async (name: string, projectName: string) => {
    if (!window.confirm(`确认删除「${projectName}」？不可恢复。`)) return;
    await runOp(`delete-${name}`, async () => {
      await deleteSemanticProject(name);
      setNotice(`已删除「${projectName}」。重启后端后 Wren 语义工具自动卸载。`);
      onChanged?.();
      await refresh();
    });
  };

  const doBuild = async (name: string, projectName: string) => {
    await runOp(`build-${name}`, async () => {
      const r = await buildSemanticProject(name);
      setNotice(`「${projectName}」${r.message}`);
      await refresh();
    });
  };

  const doValidate = async (name: string, projectName: string) => {
    await runOp(`validate-${name}`, async () => {
      const r = await validateSemanticProject(name);
      const s = r.summary as Record<string, unknown>;
      const counts = `模型 ${s.models} / 视图 ${s.views} / 关系 ${s.relationships}`;
      setNotice(`「${projectName}」${r.ok ? "通过" : "有问题"}：${counts}`);
    });
  };

  const doGitPull = async (name: string, projectName: string) => {
    await runOp(`pull-${name}`, async () => {
      const r = await gitPull(name);
      setNotice(`「${projectName}」${r.message || "更新完成"}`);
      await refresh();
    });
  };

  const doOpenDir = async (name: string) => {
    try {
      await openProjectDirectory(name);
    } catch (e) {
      setError(`打开目录失败: ${(e as Error).message}`);
    }
  };

  // ── 新建流程 ──────────────────────────────────────────────

  const doCreate = async () => {
    if (!createName.trim() || !createDbName) {
      setError("请填写项目名称并选择数据库");
      return;
    }
    await runOp("create", async () => {
      const r = await createSemanticProject({
        project_name: createName.trim(),
        db_name: createDbName,
        description: createDesc.trim() || undefined,
      });
      if (!r.ok) {
        setError(r.error || "创建失败");
        return;
      }
      setCreatedProjectName(createName.trim());
      setCreateStep(2);
      setNotice(`「${createName}」创建成功`);
      onChanged?.();
      await refresh();
    });
  };

  const doIntrospect = async () => {
    await runOp("introspect", async () => {
      const r = await introspectTables(createdProjectName, createDbName);
      if (!r.ok) {
        setError(r.error || "提取失败");
        return;
      }
      setIntrospectData({
        tables: r.tables,
        foreign_keys: r.foreign_keys,
        db_type: r.db_type || "",
      });
      setSelectedTables(new Set(r.tables.map((t) => t.name)));
      setNotice(`提取完成：${r.tables.length} 张表，${r.foreign_keys.length} 条外键`);
    });
  };

  const toggleTable = (name: string) => {
    setSelectedTables((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const toggleAllTables = () => {
    if (!introspectData) return;
    if (selectedTables.size === introspectData.tables.length) {
      setSelectedTables(new Set());
    } else {
      setSelectedTables(new Set(introspectData.tables.map((t) => t.name)));
    }
  };

  const doGenerateModels = async () => {
    if (selectedTables.size === 0) {
      setError("至少选择一张表");
      return;
    }
    await runOp("generate", async () => {
      const r = await generateModels(createdProjectName, {
        selected_tables: Array.from(selectedTables),
        include_relationships: true,
        db_name: createDbName,
      });
      if (!r.ok) {
        setError(r.error || "生成失败");
        return;
      }
      setNotice(`模型：${r.generated.models}，关系：${r.generated.relationships}`);
      setCreateStep(3);
    });
  };

  const doApplyToProject = async () => {
    await runOp("apply", async () => {
      const proj = projects.find(
        (p) => p.name === createdProjectName || p.project_name === createdProjectName
      );
      if (!proj) {
        setError("找不到项目，请刷新列表");
        return;
      }
      await associateLocalProject(proj.path, createDbName);
      setNotice(`已关联到「${createDbName}」。重启后端后 Wren 语义工具自动加载。`);
      setCreateStep(4);
      onChanged?.();
      await refresh();
    });
  };

  const doPushGit = async () => {
    if (!pushUrl.trim()) {
      setError("请填写远程仓库地址");
      return;
    }
    await runOp("push", async () => {
      const r = await pushToGit(pushName, {
        remote_url: pushUrl.trim(),
        branch: pushBranch || "main",
        tag: pushTag || undefined,
        commit_message: "初始化语义库",
      });
      if (!r.ok) {
        setError(r.error || r.message || "推送失败");
        return;
      }
      setNotice(`推送成功：${r.message}`);
    });
  };

  // ── Git 导入 ──────────────────────────────────────────────

  const doGitImport = async () => {
    if (!gitUrl.trim()) {
      setError("请填写 Git 仓库地址");
      return;
    }
    await runOp("git-import", async () => {
      const r = await importSemanticFromGit({
        repo_url: gitUrl.trim(),
        ref: gitRef.trim() || undefined,
        project_name: gitProjName.trim() || undefined,
        target_db: gitTargetDb || undefined,
        overwrite_connection: true,
      });
      if (!r.ok) {
        setError(r.error || "拉取失败");
        return;
      }
      setNotice(`已拉取「${r.project?.project_name || ""}」。重启后端后 Wren 语义工具生效。`);
      setGitUrl("");
      setGitRef("");
      setGitProjName("");
      setGitTargetDb("");
      setAddMode(null);
      onChanged?.();
      await refresh();
    });
  };

  // ── 关联本地 ──────────────────────────────────────────────

  const doLocalAssociate = async () => {
    if (!localPath.trim() || !localTargetDb) {
      setError("请填写路径并选择数据库");
      return;
    }
    await runOp("local-associate", async () => {
      await associateLocalProject(localPath.trim(), localTargetDb);
      setNotice("已关联。重启后端后 Wren 语义工具生效。");
      setLocalPath("");
      setLocalTargetDb("");
      setAddMode(null);
      onChanged?.();
      await refresh();
    });
  };

  // ── 重置新建流程 ─────────────────────────────────────────

  const resetCreate = () => {
    setCreateStep(1);
    setCreateName("");
    setCreateDbName("");
    setCreateDesc("");
    setCreatedProjectName("");
    setIntrospectData(null);
    setSelectedTables(new Set());
    setAddMode(null);
  };

  const dbOptions = dbs.map((d) => d.name);

  // ── 渲染 ──────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-3">
      {/* 头部 */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          语义库是 NL2SQL 的「业务知识大脑」，帮助系统理解数据库。
          新增/删除后需重启后端，Wren 语义工具才生效。
        </p>
        <div className="flex items-center gap-2">
          <WorkspaceBadge />
          <Button size="sm" onClick={() => setAddMode("ai")}>
            + 添加
          </Button>
        </div>
      </div>

      {/* 概览统计 */}
      {projects.length > 0 && (
        <div className="flex items-center gap-4 rounded-md border bg-muted/30 px-3 py-2 text-xs">
          <span>
            全部: <strong>{projects.length}</strong>
          </span>
          <span className="text-emerald-600">
            已构建: <strong>{projects.filter((p) => p.built).length}</strong>
          </span>
          <span className="text-amber-600">
            未构建: <strong>{projects.filter((p) => !p.built).length}</strong>
          </span>
          <span className="text-primary">
            Git: <strong>{projects.filter((p) => p.source === "git").length}</strong>
          </span>
          <span className="ml-auto text-muted-foreground">
            💡 创建语义库请前往对应数据库卡片，或点击「+ 添加」
          </span>
        </div>
      )}

      {/* 提示 */}
      {error && (
        <div className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}
      {notice && (
        <div className="whitespace-pre-wrap rounded-md bg-emerald-500/10 px-3 py-2 text-xs text-emerald-600">
          {notice}
        </div>
      )}

      {/* 语义库卡片列表 */}
      <div className="flex flex-col gap-2">
        {loading && projects.length === 0 ? (
          <div className="py-6 text-center text-xs text-muted-foreground">加载中...</div>
        ) : projects.length === 0 ? (
          <div className="py-6 text-center text-xs text-muted-foreground">
            暂无语义库，点击右上角「+ 添加」开始创建
          </div>
        ) : (
          projects.map((p) => (
            <ProjectCard
              key={p.path}
              project={p}
              busy={busy}
              busyOp={busyOp}
              isEditing={editingProject === p.name}
              onEdit={() =>
                setEditingProject(editingProject === p.name ? null : p.name)
              }
              onBuild={() => doBuild(p.name, p.project_name)}
              onValidate={() => doValidate(p.name, p.project_name)}
              onDelete={() => doDelete(p.name, p.project_name)}
              onPush={() => {
                setPushName(p.name);
                setPushUrl(p.git?.remote || "");
                setPushBranch(p.git?.branch || "main");
                setPushTag("");
                setAddMode("push");
              }}
              onPull={() => doGitPull(p.name, p.project_name)}
              onOpenDir={() => doOpenDir(p.name)}
              tables={introspectData?.tables}
              onSaved={() => refresh()}
            />
          ))
        )}
      </div>

      {/* 添加对话框 */}
      {addMode && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-lg rounded-lg border bg-background p-4 shadow-lg">
            {/* 对话框内显示错误/提示 */}
            {error && (
              <div className="mb-3 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {error}
              </div>
            )}
            {notice && (
              <div className="mb-3 whitespace-pre-wrap rounded-md bg-emerald-500/10 px-3 py-2 text-xs text-emerald-600">
                {notice}
              </div>
            )}
            {addMode === "ai" && (
              <AddDialog
                onCreate={() => {
                  resetCreate();
                  setAddMode("manual");
                }}
                onGit={() => setAddMode("git")}
                onLocal={() => setAddMode("local")}
                onClose={() => setAddMode(null)}
              />
            )}
            {addMode === "manual" && (
              <CreateFlowDialog
                step={createStep}
                dbName={createDbName}
                name={createName}
                desc={createDesc}
                dbOptions={dbOptions}
                introspectData={introspectData}
                selectedTables={selectedTables}
                busy={busy}
                busyOp={busyOp}
                onSetDbName={setCreateDbName}
                onSetName={setCreateName}
                onSetDesc={setCreateDesc}
                onCreate={doCreate}
                onIntrospect={doIntrospect}
                onToggleTable={toggleTable}
                onToggleAll={toggleAllTables}
                onGenerate={doGenerateModels}
                onApply={doApplyToProject}
                onPush={() => {
                  setPushName(createdProjectName);
                  setPushUrl("");
                  setPushBranch("main");
                  setPushTag("");
                  setAddMode("push");
                }}
                onClose={resetCreate}
              />
            )}
            {addMode === "git" && (
              <GitImportDialog
                url={gitUrl}
                ref_={gitRef}
                projName={gitProjName}
                targetDb={gitTargetDb}
                dbOptions={dbOptions}
                busy={busy}
                busyOp={busyOp}
                onSetUrl={setGitUrl}
                onSetRef={setGitRef}
                onSetProjName={setGitProjName}
                onSetTargetDb={setGitTargetDb}
                onImport={doGitImport}
                onClose={() => setAddMode(null)}
              />
            )}
            {addMode === "local" && (
              <LocalAssociateDialog
                path={localPath}
                targetDb={localTargetDb}
                dbOptions={dbOptions}
                busy={busy}
                busyOp={busyOp}
                onSetPath={setLocalPath}
                onSetTargetDb={setLocalTargetDb}
                onAssociate={doLocalAssociate}
                onClose={() => setAddMode(null)}
              />
            )}
            {addMode === "push" && (
              <PushGitDialog
                url={pushUrl}
                branch={pushBranch}
                tag={pushTag}
                busy={busy}
                busyOp={busyOp}
                onSetUrl={setPushUrl}
                onSetBranch={setPushBranch}
                onSetTag={setPushTag}
                onPush={doPushGit}
                onClose={() => setAddMode(null)}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── 卡片组件 ─────────────────────────────────────────────────

function ProjectCard({
  project: p,
  busy,
  busyOp,
  isEditing,
  onEdit,
  onBuild,
  onValidate,
  onDelete,
  onPush,
  onPull,
  onOpenDir,
  tables,
  onSaved,
}: {
  project: SemanticProject;
  busy: boolean;
  busyOp: string;
  isEditing: boolean;
  onEdit: () => void;
  onBuild: () => void;
  onValidate: () => void;
  onDelete: () => void;
  onPush: () => void;
  onPull: () => void;
  onOpenDir: () => void;
  tables?: IntrospectTable[];
  onSaved: () => void;
}) {
  const isGit = p.source === "git";
  const myBuildBusy = busyOp === `build-${p.name}`;
  const myValidateBusy = busyOp === `validate-${p.name}`;
  const myPullBusy = busyOp === `pull-${p.name}`;
  const myDeleteBusy = busyOp === `delete-${p.name}`;

  return (
    <div className="rounded-lg border bg-card">
      <div className="p-3">
        {/* 头部：名称 + 状态 */}
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold">📦 {p.project_name}</span>
              <span
                className={cn(
                  "rounded px-1.5 py-0.5 text-[10px]",
                  isGit
                    ? "bg-primary/10 text-primary"
                    : "bg-muted text-muted-foreground"
                )}
              >
                {isGit ? "Git" : "本地"}
              </span>
              <span
                className={cn(
                  "rounded px-1.5 py-0.5 text-[10px]",
                  p.built
                    ? "bg-emerald-500/10 text-emerald-600"
                    : "bg-amber-500/10 text-amber-600"
                )}
              >
                {p.built ? "✅ 已构建" : "⚠️ 未构建"}
              </span>
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {isGit && p.git && (
                <span className="mr-3">
                  {p.git.branch}
                  {p.git.commit ? `@${p.git.commit}` : ""}
                </span>
              )}
              {p.associated_dbs.length > 0 && (
                <span>关联库：{p.associated_dbs.join(", ")}</span>
              )}
            </div>
          </div>
          <button
            type="button"
            className="text-xs text-muted-foreground hover:text-foreground"
            onClick={onOpenDir}
            title="打开目录"
          >
            📂
          </button>
        </div>

        {/* 统计 */}
        {p.built && (
          <div className="mt-2 flex gap-3 text-xs text-muted-foreground">
            <span>模型: {p.models}</span>
            <span>视图: {p.views}</span>
            <span>关系: {p.relationships}</span>
            {p.cubes > 0 && <span>Cubes: {p.cubes}</span>}
          </div>
        )}

        {/* 操作按钮 */}
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={onEdit}
          >
            📝 编辑知识
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={onValidate}
            disabled={myValidateBusy}
          >
            {myValidateBusy ? "校验中..." : "🔍 校验"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={onBuild}
            disabled={myBuildBusy}
          >
            {myBuildBusy ? "构建中..." : "🔨 构建"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={onPush}
          >
            📤 推送 Git
          </Button>
          {isGit && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={onPull}
              disabled={myPullBusy}
            >
              {myPullBusy ? "更新中..." : "🔄 更新"}
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs text-destructive"
            onClick={onDelete}
            disabled={myDeleteBusy}
          >
            {myDeleteBusy ? "删除中..." : "🗑"}
          </Button>
        </div>
      </div>

      {/* 知识编辑器（展开） */}
      {isEditing && (
        <div className="border-t p-3">
          <KnowledgeEditor
            projectName={p.name}
            tables={tables}
            onClose={onEdit}
            onSaved={onSaved}
          />
        </div>
      )}
    </div>
  );
}

// ── 添加对话框：引导选择 ─────────────────────────────────────

function AddDialog({
  onCreate,
  onGit,
  onLocal,
  onClose,
}: {
  onCreate: () => void;
  onGit: () => void;
  onLocal: () => void;
  onClose: () => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">添加语义库</h3>
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground"
          onClick={onClose}
        >
          ✕
        </button>
      </div>
      <p className="text-xs text-muted-foreground">你想怎么获取语义库？</p>
      <div className="grid grid-cols-3 gap-3">
        <button
          type="button"
          className="flex flex-col items-center gap-2 rounded-lg border p-4 hover:border-primary hover:bg-primary/5 transition-colors"
          onClick={onCreate}
        >
          <span className="text-2xl">✨</span>
          <span className="text-sm font-medium">新建</span>
          <span className="text-[10px] text-muted-foreground text-center">
            从零开始创建，AI 辅助生成业务知识
          </span>
        </button>
        <button
          type="button"
          className="flex flex-col items-center gap-2 rounded-lg border p-4 hover:border-primary hover:bg-primary/5 transition-colors"
          onClick={onGit}
        >
          <span className="text-2xl">📥</span>
          <span className="text-sm font-medium">Git 导入</span>
          <span className="text-[10px] text-muted-foreground text-center">
            从远程仓库拉取已有语义库
          </span>
        </button>
        <button
          type="button"
          className="flex flex-col items-center gap-2 rounded-lg border p-4 hover:border-primary hover:bg-primary/5 transition-colors"
          onClick={onLocal}
        >
          <span className="text-2xl">🔗</span>
          <span className="text-sm font-medium">关联本地</span>
          <span className="text-[10px] text-muted-foreground text-center">
            关联磁盘上已有的语义库目录
          </span>
        </button>
      </div>
      <p className="text-[10px] text-muted-foreground text-center">
        💡 不确定？选择「新建」，我们会引导你完成
      </p>
    </div>
  );
}

// ── 新建流程对话框 ───────────────────────────────────────────

function CreateFlowDialog({
  step,
  dbName,
  name,
  desc,
  dbOptions,
  introspectData,
  selectedTables,
  busy,
  busyOp,
  onSetDbName,
  onSetName,
  onSetDesc,
  onCreate,
  onIntrospect,
  onToggleTable,
  onToggleAll,
  onGenerate,
  onApply,
  onPush,
  onClose,
}: {
  step: CreateStep;
  dbName: string;
  name: string;
  desc: string;
  dbOptions: string[];
  introspectData: {
    tables: IntrospectTable[];
    foreign_keys: IntrospectForeignKey[];
    db_type: string;
  } | null;
  selectedTables: Set<string>;
  busy: boolean;
  busyOp: string;
  onSetDbName: (v: string) => void;
  onSetName: (v: string) => void;
  onSetDesc: (v: string) => void;
  onCreate: () => void;
  onIntrospect: () => void;
  onToggleTable: (name: string) => void;
  onToggleAll: () => void;
  onGenerate: () => void;
  onApply: () => void;
  onPush: () => void;
  onClose: () => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">新建语义库</h3>
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground"
          onClick={onClose}
        >
          ✕
        </button>
      </div>

      {/* 步骤指示器 */}
      <div className="flex items-center gap-1 text-xs">
        {[1, 2, 3, 4].map((s) => (
          <div key={s} className="flex items-center gap-1">
            <span
              className={cn(
                "flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold",
                step >= s
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground"
              )}
            >
              {s}
            </span>
            <span
              className={cn(
                step >= s ? "text-foreground" : "text-muted-foreground"
              )}
            >
              {["基本信息", "选择表", "生成模型", "完成"][s - 1]}
            </span>
            {s < 4 && <span className="mx-1 text-muted-foreground">→</span>}
          </div>
        ))}
      </div>

      {/* Step 1: 基本信息 */}
      {step === 1 && (
        <div className="grid gap-2">
          <div className="grid gap-1">
            <Label className="text-xs">目标数据库 *</Label>
            <Select
              value={dbName || NONE_SENTINEL}
              onValueChange={(v) => onSetDbName(v === NONE_SENTINEL ? "" : v)}
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="选择数据库" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE_SENTINEL}>请选择...</SelectItem>
                {dbOptions.map((n) => (
                  <SelectItem key={n} value={n}>
                    {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-1">
              <Label className="text-xs">项目名称 *</Label>
              <Input
                className="h-8 text-xs"
                value={name}
                onChange={(e) => onSetName(e.target.value)}
                placeholder="如 imdb_semantic"
              />
            </div>
            <div className="grid gap-1">
              <Label className="text-xs">描述</Label>
              <Input
                className="h-8 text-xs"
                value={desc}
                onChange={(e) => onSetDesc(e.target.value)}
                placeholder="可选"
              />
            </div>
          </div>
          <div className="flex justify-end">
            <Button
              size="sm"
              onClick={onCreate}
              disabled={busy || !name.trim() || !dbName}
            >
              {busyOp === "create" ? "创建中..." : "创建项目 →"}
            </Button>
          </div>
        </div>
      )}

      {/* Step 2: 选择表 */}
      {step === 2 && (
        <div className="grid gap-2">
          {!introspectData ? (
            <div className="flex justify-end">
              <Button size="sm" onClick={onIntrospect} disabled={busy}>
                {busyOp === "introspect" ? "提取中..." : "提取表结构"}
              </Button>
            </div>
          ) : (
            <>
              <div className="text-xs text-muted-foreground">
                {introspectData.db_type && (
                  <span className="mr-2">类型: {introspectData.db_type}</span>
                )}
                共 {introspectData.tables.length} 张表，
                {introspectData.foreign_keys.length} 条外键
              </div>
              <div className="max-h-[200px] overflow-auto rounded border">
                <table className="w-full text-left text-xs">
                  <thead className="sticky top-0 bg-muted/60">
                    <tr>
                      <th className="px-2 py-1 w-8">
                        <input
                          type="checkbox"
                          checked={
                            selectedTables.size === introspectData.tables.length
                          }
                          onChange={onToggleAll}
                        />
                      </th>
                      <th className="px-2 py-1">表名</th>
                      <th className="px-2 py-1">列数</th>
                      <th className="px-2 py-1">注释</th>
                    </tr>
                  </thead>
                  <tbody>
                    {introspectData.tables.map((t) => (
                      <tr key={t.name} className="border-t">
                        <td className="px-2 py-1">
                          <input
                            type="checkbox"
                            checked={selectedTables.has(t.name)}
                            onChange={() => onToggleTable(t.name)}
                          />
                        </td>
                        <td className="px-2 py-1 font-medium">{t.name}</td>
                        <td className="px-2 py-1 text-muted-foreground">
                          {t.column_count}
                        </td>
                        <td className="px-2 py-1 truncate max-w-[100px] text-muted-foreground">
                          {t.comment || "-"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex justify-end">
                <Button
                  size="sm"
                  onClick={onGenerate}
                  disabled={busy || selectedTables.size === 0}
                >
                  {busyOp === "generate"
                    ? "生成中..."
                    : `生成模型 (${selectedTables.size} 表) →`}
                </Button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Step 3: 完成 → 关联 */}
      {step === 3 && (
        <div className="grid gap-3">
          <div className="rounded bg-emerald-500/10 p-3 text-xs text-emerald-600">
            ✅ 模型已生成！接下来可以关联数据库或推送到 Git。
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs">关联到数据库「{dbName}」</span>
            <Button size="sm" onClick={onApply} disabled={busy}>
              {busyOp === "apply" ? "关联中..." : "关联数据库"}
            </Button>
          </div>
          <div className="flex justify-end">
            <Button variant="outline" size="sm" onClick={onPush}>
              📤 推送到 Git
            </Button>
          </div>
        </div>
      )}

      {/* Step 4: 完成 */}
      {step === 4 && (
        <div className="grid gap-3">
          <div className="rounded bg-emerald-500/10 p-3 text-xs text-emerald-600">
            ✅ 语义库已创建并关联！可在列表中编辑业务知识、构建 MDL。
            <br />
            重启后端后，Wren 语义工具（wrenai_*）自动加载。
          </div>
          <div className="flex justify-end">
            <Button size="sm" onClick={onClose}>
              完成
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Git 导入对话框 ───────────────────────────────────────────

function GitImportDialog({
  url,
  ref_,
  projName,
  targetDb,
  dbOptions,
  busy,
  busyOp,
  onSetUrl,
  onSetRef,
  onSetProjName,
  onSetTargetDb,
  onImport,
  onClose,
}: {
  url: string;
  ref_: string;
  projName: string;
  targetDb: string;
  dbOptions: string[];
  busy: boolean;
  busyOp: string;
  onSetUrl: (v: string) => void;
  onSetRef: (v: string) => void;
  onSetProjName: (v: string) => void;
  onSetTargetDb: (v: string) => void;
  onImport: () => void;
  onClose: () => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">📥 从 Git 导入</h3>
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground"
          onClick={onClose}
        >
          ✕
        </button>
      </div>
      <div className="grid gap-2">
        <div className="grid gap-1">
          <Label className="text-xs">仓库地址（http/https）*</Label>
          <Input
            className="h-8 text-xs"
            value={url}
            onChange={(e) => onSetUrl(e.target.value)}
            placeholder="https://github.com/org/repo.git"
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="grid gap-1">
            <Label className="text-xs">分支/Tag</Label>
            <Input
              className="h-8 text-xs"
              value={ref_}
              onChange={(e) => onSetRef(e.target.value)}
              placeholder="main / v1.0"
            />
          </div>
          <div className="grid gap-1">
            <Label className="text-xs">项目名</Label>
            <Input
              className="h-8 text-xs"
              value={projName}
              onChange={(e) => onSetProjName(e.target.value)}
              placeholder="默认取仓库名"
            />
          </div>
        </div>
        <div className="grid gap-1">
          <Label className="text-xs">关联数据库</Label>
          <Select
            value={targetDb || NONE_SENTINEL}
            onValueChange={(v) =>
              onSetTargetDb(v === NONE_SENTINEL ? "" : v)
            }
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="不关联" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE_SENTINEL}>不关联</SelectItem>
              {dbOptions.map((n) => (
                <SelectItem key={n} value={n}>
                  {n}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex justify-end">
          <Button size="sm" onClick={onImport} disabled={busy || !url.trim()}>
            {busyOp === "git-import" ? "拉取中..." : "拉取"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── 关联本地对话框 ───────────────────────────────────────────

function LocalAssociateDialog({
  path,
  targetDb,
  dbOptions,
  busy,
  busyOp,
  onSetPath,
  onSetTargetDb,
  onAssociate,
  onClose,
}: {
  path: string;
  targetDb: string;
  dbOptions: string[];
  busy: boolean;
  busyOp: string;
  onSetPath: (v: string) => void;
  onSetTargetDb: (v: string) => void;
  onAssociate: () => void;
  onClose: () => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">🔗 关联本地目录</h3>
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground"
          onClick={onClose}
        >
          ✕
        </button>
      </div>
      <div className="grid gap-2">
        <div className="grid gap-1">
          <Label className="text-xs">项目目录绝对路径 *</Label>
          <Input
            className="h-8 text-xs"
            value={path}
            onChange={(e) => onSetPath(e.target.value)}
            placeholder="D:/workspace/my_semantic"
          />
        </div>
        <div className="grid gap-1">
          <Label className="text-xs">关联数据库 *</Label>
          <Select
            value={targetDb || NONE_SENTINEL}
            onValueChange={(v) =>
              onSetTargetDb(v === NONE_SENTINEL ? "" : v)
            }
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="选择数据库" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE_SENTINEL}>请选择...</SelectItem>
              {dbOptions.map((n) => (
                <SelectItem key={n} value={n}>
                  {n}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex justify-end">
          <Button
            size="sm"
            onClick={onAssociate}
            disabled={busy || !path.trim() || !targetDb}
          >
            {busyOp === "local-associate" ? "关联中..." : "关联"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── 推送 Git 对话框 ─────────────────────────────────────────

function PushGitDialog({
  url,
  branch,
  tag,
  busy,
  busyOp,
  onSetUrl,
  onSetBranch,
  onSetTag,
  onPush,
  onClose,
}: {
  url: string;
  branch: string;
  tag: string;
  busy: boolean;
  busyOp: string;
  onSetUrl: (v: string) => void;
  onSetBranch: (v: string) => void;
  onSetTag: (v: string) => void;
  onPush: () => void;
  onClose: () => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">📤 推送至 Git</h3>
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground"
          onClick={onClose}
        >
          ✕
        </button>
      </div>
      <div className="grid gap-2">
        <div className="grid gap-1">
          <Label className="text-xs">远程仓库地址 *</Label>
          <Input
            className="h-8 text-xs"
            value={url}
            onChange={(e) => onSetUrl(e.target.value)}
            placeholder="https://github.com/org/repo.git"
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="grid gap-1">
            <Label className="text-xs">分支</Label>
            <Input
              className="h-8 text-xs"
              value={branch}
              onChange={(e) => onSetBranch(e.target.value)}
              placeholder="main"
            />
          </div>
          <div className="grid gap-1">
            <Label className="text-xs">标签（可选）</Label>
            <Input
              className="h-8 text-xs"
              value={tag}
              onChange={(e) => onSetTag(e.target.value)}
              placeholder="v1.0.0"
            />
          </div>
        </div>
        <div className="flex justify-end">
          <Button size="sm" onClick={onPush} disabled={busy || !url.trim()}>
            {busyOp === "push" ? "推送中..." : "推送"}
          </Button>
        </div>
      </div>
    </div>
  );
}
