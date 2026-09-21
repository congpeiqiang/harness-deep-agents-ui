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
  adoptSemanticFromGit,
  associateLocalProject,
  pushToGit,
  getGitStatus,
  gitPull,
  getGitRefs,
  getGitSshKey,
  openProjectDirectory,
  type SemanticProject,
  type IntrospectTable,
  type IntrospectForeignKey,
  type GitRefsInfo,
  type GitStatusInfo,
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

type AddMode = "ai" | "manual" | "git" | "local" | "push" | null;
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
  // Git 导入撞上同名本地语义库：后端回 code="exists"，这里存待确认替换的信息
  const [gitReplaceFiles, setGitReplaceFiles] = useState<string[] | null>(null);

  // 接入 Git：非 Git 的本地语义库绑定并拉取一个已有远程仓库（与「更新」同一个对话框）
  const [adoptUrl, setAdoptUrl] = useState("");

  // 关联本地
  const [localPath, setLocalPath] = useState("");
  const [localTargetDb, setLocalTargetDb] = useState("");

  // 推送 Git
  const [pushName, setPushName] = useState("");
  const [pushUrl, setPushUrl] = useState("");
  const [pushBranch, setPushBranch] = useState("main");
  const [pushTag, setPushTag] = useState("");
  const [pushForce, setPushForce] = useState(false);
  const [pushCommitMsg, setPushCommitMsg] = useState("");

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
      setNotice(`已删除「${projectName}」。Wren 语义工具已自动卸载。`);
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

  // 更新语义库：先选 ref（分支/tag，默认「最新」= 远程默认分支），可选更新后自动构建。
  // 不自动构建时给出提示——wrenai 读的是 target/mdl.json，源文件改动不构建不生效。
  const [pullTarget, setPullTarget] = useState<SemanticProject | null>(null);
  const [pullRef, setPullRef] = useState("");
  const [pullAutoBuild, setPullAutoBuild] = useState(true);
  // 非 Git 模式下后端回 code="local_content"（本地有自建内容）后置 true：
  // 状态预检可能失败或用户期间又改了文件，所以以「后端真的拒绝过一次」为兜底判据。
  const [adoptNeedsConfirm, setAdoptNeedsConfirm] = useState(false);

  const openPull = (p: SemanticProject) => {
    setPullRef("");
    setPullAutoBuild(true);
    setAdoptUrl("");
    setAdoptNeedsConfirm(false);
    setPullTarget(p);
  };


  // discardLocal：用户在对话框里显式勾了「放弃本地未提交改动」（后端会先 stash 备份）
  const doGitPull = async (discardLocal: boolean) => {
    const p = pullTarget;
    if (!p) return;
    await runOp(`pull-${p.name}`, async () => {
      const r = await gitPull(p.name, pullRef || undefined, discardLocal);
      let msg = `「${p.project_name}」${r.message || "更新完成"}`;
      if (r.changed && pullAutoBuild) {
        try {
          const b = await buildSemanticProject(p.name);
          msg += `\n${b.message}`;
        } catch (e) {
          msg += `\n构建失败：${(e as Error).message}（可稍后手动点「构建」）`;
        }
      }
      setNotice(msg);
      setPullTarget(null);
      await refresh();
    });
  };

  // 接入 Git：把已有本地语义库接管到远程仓库（备份本地 → 干净 clone → 构建）。
  // 本地有自建内容时后端回 ok:false/code:"local_content" 且**不动任何文件**，
  // 用户勾确认后再带 discard_local 重发（内容只备份不删）。
  const doGitAdopt = async (discardLocal: boolean) => {
    const p = pullTarget;
    if (!p) return;
    const repoUrl = adoptUrl.trim();
    if (!repoUrl) {
      setError("请填写 Git 仓库地址");
      return;
    }
    await runOp(`adopt-${p.name}`, async () => {
      const r = await adoptSemanticFromGit(p.name, {
        repo_url: repoUrl,
        ref: pullRef.trim() || undefined,
        discard_local: discardLocal,
        build: pullAutoBuild,
      });
      if (!r.ok) {
        if (r.code === "local_content") {
          // 让对话框把确认勾选显出来（并保持打开，用户勾完直接重发）
          setAdoptNeedsConfirm(true);
        }
        setError(r.error || "接入失败");
        return;
      }
      let msg = `「${p.project_name}」已接入 Git 仓库`;
      if (r.build_note) msg += `\n${r.build_note}`;
      if (r.backup_dir) msg += `\n原内容已备份到：${r.backup_dir}`;
      if (r.warnings?.length) msg += `\n${r.warnings.join("\n")}`;
      setNotice(msg);
      setAdoptNeedsConfirm(false);
      setPullTarget(null);
      onChanged?.();
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
      setNotice(`已关联到「${createDbName}」。Wren 语义工具已自动加载。`);
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
        commit_message: pushCommitMsg.trim(),
        force: pushForce,
      });
      if (!r.ok) {
        setError(r.error || r.message || "推送失败");
        return;
      }
      setNotice(`推送成功：${r.message}`);
    });
  };

  // ── Git 导入 ──────────────────────────────────────────────

  // replaceExisting=true 表示用户已在确认框上确认「用仓库内容替换同名本地语义库」
  const doGitImport = async (replaceExisting = false) => {
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
        replace_existing: replaceExisting,
      });
      if (!r.ok) {
        // 同名本地语义库已存在：后端回 2xx + code="exists"（没动任何文件），
        // 让用户确认后再带 replace_existing 重发，而不是吃一句死错误
        if (r.code === "exists") {
          setGitReplaceFiles(r.local_files || []);
          setNotice(r.error || "同名语义库已存在");
          return;
        }
        setError(r.error || "拉取失败");
        return;
      }
      setNotice(`已拉取「${r.project?.project_name || ""}」${r.build_note ? `。${r.build_note}` : ""}`);
      setGitUrl("");
      setGitRef("");
      setGitProjName("");
      setGitTargetDb("");
      setGitReplaceFiles(null);
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
      setNotice("已关联。Wren 语义工具已自动生效。");
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
                setPushCommitMsg("");
                setAddMode("push");
              }}
              onPull={() => openPull(p)}
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
                onGit={() => {
                  setGitReplaceFiles(null);
                  setAddMode("git");
                }}
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
                replaceFiles={gitReplaceFiles}
                busy={busy}
                busyOp={busyOp}
                onSetUrl={setGitUrl}
                onSetRef={setGitRef}
                onSetProjName={(v) => {
                  // 改了目标名字就不再是「替换那个同名库」了，撤掉确认态
                  setGitProjName(v);
                  setGitReplaceFiles(null);
                }}
                onSetTargetDb={setGitTargetDb}
                onImport={doGitImport}
                onCancelReplace={() => {
                  setGitReplaceFiles(null);
                  setNotice(null);
                }}
                onClose={() => {
                  setGitReplaceFiles(null);
                  setAddMode(null);
                }}
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
                commitMsg={pushCommitMsg}
                force={pushForce}
                busy={busy}
                busyOp={busyOp}
                onSetUrl={setPushUrl}
                onSetBranch={setPushBranch}
                onSetTag={setPushTag}
                onSetCommitMsg={setPushCommitMsg}
                onSetForce={setPushForce}
                onPush={doPushGit}
                onClose={() => setAddMode(null)}
              />
            )}
          </div>
        </div>
      )}

      {/* 更新 / 接入 Git：Git 库选 ref（分支/tag，默认最新）；本地库填仓库地址 */}
      {pullTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          {/* 接入模式内容较高（仓库地址 + 自建文件清单 + 确认 + 构建勾选），
              小屏要能滚，否则底部按钮会被挤出视口点不到 */}
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg border bg-background p-4 shadow-lg">
            {error && (
              <div className="mb-3 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {error}
              </div>
            )}
            <PullGitDialog
              name={pullTarget.name}
              projectName={pullTarget.project_name}
              isGit={pullTarget.source === "git"}
              currentBranch={pullTarget.git?.branch || ""}
              currentCommit={pullTarget.git?.commit || ""}
              repoUrl={adoptUrl}
              ref_={pullRef}
              autoBuild={pullAutoBuild}
              needsConfirm={adoptNeedsConfirm}
              busy={busy}
              busyOp={busyOp}
              onSetRepoUrl={setAdoptUrl}
              onSetRef={setPullRef}
              onSetAutoBuild={setPullAutoBuild}
              onPull={doGitPull}
              onAdopt={doGitAdopt}
              onClose={() => {
                if (
                  busyOp === `pull-${pullTarget.name}` ||
                  busyOp === `adopt-${pullTarget.name}`
                )
                  return;
                setPullTarget(null);
              }}
            />
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
  const myAdoptBusy = busyOp === `adopt-${p.name}`;
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
          {/* 本地库也走这个入口：接上 git 上已有的同名语义库（之后卡片就变成 Git） */}
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={onPull}
            disabled={myPullBusy || myAdoptBusy}
          >
            {isGit
              ? myPullBusy
                ? "更新中..."
                : "🔄 更新"
              : myAdoptBusy
                ? "接入中..."
                : "🔗 接入 Git"}
          </Button>
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
  replaceFiles,
  busy,
  busyOp,
  onSetUrl,
  onSetRef,
  onSetProjName,
  onSetTargetDb,
  onImport,
  onCancelReplace,
  onClose,
}: {
  url: string;
  ref_: string;
  projName: string;
  targetDb: string;
  dbOptions: string[];
  /** 非空 = 后端报「同名本地语义库已存在」，这里是会被替换掉的本地自建文件 */
  replaceFiles: string[] | null;
  busy: boolean;
  busyOp: string;
  onSetUrl: (v: string) => void;
  onSetRef: (v: string) => void;
  onSetProjName: (v: string) => void;
  onSetTargetDb: (v: string) => void;
  onImport: (replaceExisting: boolean) => void;
  onCancelReplace: () => void;
  onClose: () => void;
}) {
  const [replaceOk, setReplaceOk] = useState(false);
  useEffect(() => {
    setReplaceOk(false);
  }, [replaceFiles]);

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
        {replaceFiles && (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/5 px-2 py-1.5 text-[11px] leading-relaxed text-amber-600">
            <div className="font-medium">
              ⚠ 「{projName.trim() || "该名称"}」下已有本地语义库，拉取会用仓库内容替换它
              {replaceFiles.length > 0 ? `（${replaceFiles.length} 个自建文件）` : ""}
            </div>
            {replaceFiles.length > 0 && (
              <ul className="mt-1 list-disc pl-4 font-mono break-all">
                {replaceFiles.slice(0, 5).map((f) => (
                  <li key={f}>{f}</li>
                ))}
                {replaceFiles.length > 5 && <div>…共 {replaceFiles.length} 个</div>}
              </ul>
            )}
            <div className="mt-1 text-amber-600/80">
              原文件会整体备份到该库目录下的备份文件夹（不删除），需要时可拷回。
            </div>
          </div>
        )}
        {replaceFiles && (
          <div className="flex items-center gap-2 rounded border border-dashed border-destructive/40 px-2 py-1.5">
            <input
              id="git-import-replace"
              type="checkbox"
              checked={replaceOk}
              onChange={(e) => setReplaceOk(e.target.checked)}
              className="h-3.5 w-3.5"
            />
            <Label htmlFor="git-import-replace" className="text-xs">
              确认用仓库内容替换本地语义库（先备份，不删除）
            </Label>
          </div>
        )}
        <div className="flex justify-end gap-2">
          {replaceFiles && (
            <Button variant="outline" size="sm" onClick={onCancelReplace} disabled={busy}>
              换个名字
            </Button>
          )}
          <Button
            size="sm"
            onClick={() => onImport(!!replaceFiles)}
            disabled={busy || !url.trim() || (!!replaceFiles && !replaceOk)}
          >
            {busyOp === "git-import"
              ? "拉取中..."
              : replaceFiles
                ? "替换并拉取"
                : "拉取"}
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

// ── 更新语义库对话框（选分支 / tag）─────────────────────────

const LATEST_SENTINEL = "__latest__";

function PullGitDialog({
  name,
  projectName,
  isGit,
  currentBranch,
  currentCommit,
  repoUrl,
  ref_,
  autoBuild,
  needsConfirm,
  busy,
  busyOp,
  onSetRepoUrl,
  onSetRef,
  onSetAutoBuild,
  onPull,
  onAdopt,
  onClose,
}: {
  name: string;
  projectName: string;
  /** false = 本地新建的库，本对话框是「接入 Git」模式（先绑远程仓库再拉） */
  isGit: boolean;
  currentBranch: string;
  currentCommit: string;
  repoUrl: string;
  ref_: string;
  autoBuild: boolean;
  /** 本地库有自建内容，需用户勾确认才放行（后端会备份，不删） */
  needsConfirm: boolean;
  busy: boolean;
  busyOp: string;
  onSetRepoUrl: (v: string) => void;
  onSetRef: (v: string) => void;
  onSetAutoBuild: (v: boolean) => void;
  onPull: (discardLocal: boolean) => void;
  onAdopt: (discardLocal: boolean) => void;
  onClose: () => void;
}) {
  const [refs, setRefs] = useState<GitRefsInfo | null>(null);
  const [refsErr, setRefsErr] = useState<string | null>(null);
  // 打开对话框就预检本地改动：不让用户点了「更新」才吃一句拒绝（后端护栏是
  // 宁可拒绝也不覆盖，本地脏了按钮就是死路 —— 2026-09-15 生产反馈）
  const [status, setStatus] = useState<GitStatusInfo | null>(null);
  const [statusErr, setStatusErr] = useState<string | null>(null);
  const [discardLocal, setDiscardLocal] = useState(false);
  const myBusy = busy && busyOp === (isGit ? `pull-${name}` : `adopt-${name}`);

  useEffect(() => {
    let alive = true;
    setRefs(null);
    setRefsErr(null);
    setStatus(null);
    setStatusErr(null);
    setDiscardLocal(false);
    // 还没绑 git 的库取不到远程 ref（后端直接 400），别白跑一趟
    if (isGit) {
      getGitRefs(name)
        .then((r) => {
          if (alive) setRefs(r);
        })
        .catch((e: Error) => {
          if (alive) setRefsErr(e.message);
        });
    }
    getGitStatus(name)
      .then((r) => {
        if (alive) setStatus(r);
      })
      .catch((e: Error) => {
        if (alive) setStatusErr(e.message);
      });
    return () => {
      alive = false;
    };
  }, [name, isGit]);

  const isTag = !!refs && refs.tags.some((t) => t.name === ref_);
  // 只有「会拦住更新的已跟踪文件改动」才算挡路（未跟踪文件不拦，别误报）
  const localChanges = status?.local_changes || [];
  const blockedByLocal = localChanges.length > 0;
  // 未绑 git 时：本地自建内容（target/ 构建产物也算）会被仓库版本整个替换，
  // 所以状态预检说「不是空骨架」就要确认；预检失败或后端已拒绝过一次也一律要确认。
  const adoptLocalFiles = status?.adopt_local_files || [];
  const statusPending = !status && !statusErr;
  const confirmContent =
    needsConfirm || statusPending || !status?.adopt_pristine || !!statusErr;
  const canRun = isGit
    ? !myBusy && (!blockedByLocal || discardLocal)
    : !myBusy &&
      !!repoUrl.trim() &&
      (!confirmContent || discardLocal);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">
          {isGit ? `🔄 更新「${projectName}」` : `🔗 接入 Git「${projectName}」`}
        </h3>
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground"
          onClick={onClose}
        >
          ✕
        </button>
      </div>

      {isGit ? (
        <div className="rounded-md border bg-muted/40 px-2 py-1.5 text-[11px] text-muted-foreground">
          当前：{currentBranch || "detached"}@{currentCommit || "?"}
          {refs?.default_branch ? ` 远程默认分支：${refs.default_branch}` : ""}
        </div>
      ) : (
        <div className="grid gap-1">
          <Label className="text-xs">仓库地址（http/https/ssh）*</Label>
          <Input
            className="h-8 text-xs"
            value={repoUrl}
            onChange={(e) => onSetRepoUrl(e.target.value)}
            placeholder="https://gitlab.example.com/team/xxx_semantic.git"
            disabled={myBusy}
          />
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            绑定后本库的源文件以仓库为准；之后卡片上会变成「Git」，用「🔄 更新」跟进远程改动。
          </p>
        </div>
      )}

      {blockedByLocal && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 px-2 py-1.5 text-[11px] leading-relaxed text-destructive">
          <div className="font-medium">
            ⚠ 本地有 {localChanges.length} 个文件未提交，直接更新会被拒绝（不会覆盖你的改动）
          </div>
          <ul className="mt-1 list-disc pl-4 font-mono break-all">
            {localChanges.slice(0, 5).map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
          {localChanges.length > 5 && <div>…共 {localChanges.length} 个</div>}
          <div className="mt-1 text-destructive/80">
            建议先「推送 Git」把改动提交到远程；不想保留则勾选下方选项，后端会先
            <code className="mx-0.5">git stash</code>备份再更新。
          </div>
        </div>
      )}
      {!isGit && statusPending && (
        <div className="text-[11px] text-muted-foreground">读取本地内容…</div>
      )}
      {!isGit && !needsConfirm && !statusPending && confirmContent && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/5 px-2 py-1.5 text-[11px] leading-relaxed text-amber-600">
          <div className="font-medium">
            本库已有自建内容，接入后会以仓库版本替换
            {status?.adopt_built ? "（含已构建的 target/）" : ""}
          </div>
          {adoptLocalFiles.length > 0 && (
            <ul className="mt-1 list-disc pl-4 font-mono break-all">
              {adoptLocalFiles.slice(0, 5).map((f) => (
                <li key={f}>{f}</li>
              ))}
              {adoptLocalFiles.length > 5 && <div>…共 {adoptLocalFiles.length} 个</div>}
            </ul>
          )}
          <div className="mt-1 text-amber-600/80">
            确认后这些文件会被整体备份到库目录下的备份文件夹（不删除），需要时可拷回。
          </div>
        </div>
      )}
      {!isGit && !statusPending && !confirmContent && (
        <div className="text-[11px] text-muted-foreground">
          （本库还没有自建内容，可直接接入）
        </div>
      )}
      {!isGit && statusErr && (
        <div className="text-[11px] text-muted-foreground">
          （无法预检本地内容：{statusErr}，将按「有自建内容」处理）
        </div>
      )}

      {((isGit && blockedByLocal) || (!isGit && confirmContent)) && (
        <div className="flex items-center gap-2 rounded border border-dashed border-destructive/40 px-2 py-1.5">
          <input
            id="pull-discard-local"
            type="checkbox"
            checked={discardLocal}
            onChange={(e) => setDiscardLocal(e.target.checked)}
            className="h-3.5 w-3.5"
          />
          <Label htmlFor="pull-discard-local" className="text-xs">
            {isGit
              ? "放弃本地未提交改动并更新（先自动 git stash 备份，可用 git stash pop 找回）"
              : "确认用仓库内容替换本地自建内容（后端会先备份，不会删除）"}
          </Label>
        </div>
      )}

      <div className="grid gap-1">
        <Label className="text-xs">{isGit ? "更新到" : "拉取（分支/Tag，留空 = 默认分支）"}</Label>
        {!isGit ? (
          <Input
            className="h-8 text-xs"
            value={ref_}
            onChange={(e) => onSetRef(e.target.value)}
            placeholder="main / v1.0"
            disabled={myBusy}
          />
        ) : refsErr ? (
          <div className="text-[11px] text-destructive">
            ⚠ 读取远程分支/tag 失败：{refsErr}（仍可尝试更新到「最新」）
          </div>
        ) : !refs ? (
          <div className="text-[11px] text-muted-foreground">读取远程分支/tag…</div>
        ) : (
          <Select
            value={ref_ || LATEST_SENTINEL}
            onValueChange={(v) => onSetRef(v === LATEST_SENTINEL ? "" : v)}
            disabled={myBusy}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="最新" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={LATEST_SENTINEL}>
                最新（默认分支{refs.default_branch ? `：${refs.default_branch}` : ""}）
              </SelectItem>
              {refs.branches.map((b) => (
                <SelectItem key={`b-${b.name}`} value={b.name}>
                  分支 {b.name}@{b.sha.slice(0, 7)}
                </SelectItem>
              ))}
              {refs.tags.map((t) => (
                <SelectItem key={`t-${t.name}`} value={t.name}>
                  Tag {t.name}@{t.sha.slice(0, 7)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {isGit ? (
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            {isTag
              ? "Tag：detached 检出该版本（不跟随分支后续提交）。"
              : "分支：本地同名分支重置到远程最新；本地未推送提交 / 未提交改动会被拒绝，不会静默覆盖。"}
            {status && status.has_local_changes && !blockedByLocal
              ? "（本地只有未跟踪文件 / 构建产物改动，不影响更新）"
              : ""}
          </p>
        ) : (
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            填了分支/Tag 就检出该版本（Tag 为 detached）；留空取仓库默认分支最新。
          </p>
        )}
      </div>

      <div className="flex items-center gap-2 rounded border border-dashed px-2 py-1.5">
        <input
          id="pull-autobuild"
          type="checkbox"
          checked={autoBuild}
          onChange={(e) => onSetAutoBuild(e.target.checked)}
          className="h-3.5 w-3.5"
        />
        <Label htmlFor="pull-autobuild" className="text-xs">
          {isGit ? "更新后自动构建 MDL" : "接入后自动构建 MDL"}（metadata / 知识改动需构建才生效）
        </Label>
      </div>

      <div className="text-[11px] leading-relaxed text-muted-foreground">
        {isGit ? "更新" : "接入"}只换源文件；wrenai 实际读的是{" "}
        <code>target/mdl.json</code>。构建后即刻生效，无需重启后端。
      </div>

      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onClose} disabled={myBusy}>
          取消
        </Button>
        <Button
          size="sm"
          onClick={() => (isGit ? onPull(discardLocal) : onAdopt(discardLocal))}
          disabled={!canRun}
        >
          {isGit
            ? myBusy
              ? "更新中..."
              : "更新"
            : myBusy
              ? "接入中..."
              : "接入并拉取"}
        </Button>
      </div>
    </div>
  );
}

// ── 推送 Git 对话框 ─────────────────────────────────────────

function PushGitDialog({
  url,
  branch,
  tag,
  commitMsg,
  force,
  busy,
  busyOp,
  onSetUrl,
  onSetBranch,
  onSetTag,
  onSetCommitMsg,
  onSetForce,
  onPush,
  onClose,
}: {
  url: string;
  branch: string;
  tag: string;
  commitMsg: string;
  force: boolean;
  busy: boolean;
  busyOp: string;
  onSetUrl: (v: string) => void;
  onSetBranch: (v: string) => void;
  onSetTag: (v: string) => void;
  onSetCommitMsg: (v: string) => void;
  onSetForce: (v: boolean) => void;
  onPush: () => void;
  onClose: () => void;
}) {
  // SSH 公钥（后端推送用身份，账号级）——打开弹窗即拉取，便于复制到 GitLab
  const [pubkey, setPubkey] = useState<string | null>(null);
  const [pubkeyErr, setPubkeyErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const pubkeyInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let alive = true;
    getGitSshKey()
      .then((r) => {
        if (!alive) return;
        if (r.ok && r.pubkey) setPubkey(r.pubkey);
        else setPubkeyErr(r.error || "获取 SSH 公钥失败");
      })
      .catch((e: Error) => {
        if (alive) setPubkeyErr(e.message);
      });
    return () => {
      alive = false;
    };
  }, []);

  // 复制文本：仅安全上下文（https/localhost）可用 Clipboard API；
  // 生产是 http 局域网 IP → navigator.clipboard 不存在，必须用隐藏 textarea + execCommand 兜底。
  // 返回是否真正写入成功——execCommand 在复制未选中/被浏览器拒时会静默失败，不能无条件报成功。
  const copyTextToClipboard = async (text: string): Promise<boolean> => {
    try {
      if (
        typeof window !== "undefined" &&
        window.isSecureContext &&
        navigator.clipboard?.writeText
      ) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch {
      /* Clipboard API 失败 → 走 execCommand 兜底 */
    }
    // 兜底 textarea 必须真正移出视口（-9999px）并 focus+setSelectionRange，
    // 否则部分浏览器 select() 不生效 → execCommand 复制的是旧的/空的选区
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "0";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    let ok = false;
    try {
      ta.focus();
      ta.select();
      ta.setSelectionRange(0, text.length);
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    document.body.removeChild(ta);
    return ok;
  };

  const copyPubkey = async () => {
    if (!pubkey) return;
    const ok = await copyTextToClipboard(pubkey);
    if (ok) {
      setCopyFailed(false);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } else {
      // 自动复制被拒 → 主动全选公钥本体，引导用户 Ctrl+C 手动复制
      setCopied(false);
      setCopyFailed(true);
      window.setTimeout(() => {
        pubkeyInputRef.current?.focus();
        pubkeyInputRef.current?.select();
      }, 0);
    }
  };

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
      {/* 后端推送身份：SSH 公钥（账号级，配一次 GitLab 可推所有仓库） */}
      <div className="rounded-md border bg-muted/40 px-2 py-2">
        <div className="mb-1 flex items-center justify-between gap-2">
          <span className="text-[11px] font-medium text-muted-foreground">
            后端推送使用此 SSH 公钥认证
          </span>
          {pubkey && (
            <Button
              variant="outline"
              size="sm"
              className="h-6 px-2 text-[11px]"
              onClick={copyPubkey}
            >
              {copied ? "✓ 已复制" : "复制公钥"}
            </Button>
          )}
        </div>
        {pubkey ? (
          <input
            ref={pubkeyInputRef}
            readOnly
            value={pubkey}
            onFocus={(e) => e.currentTarget.select()}
            onClick={(e) => e.currentTarget.select()}
            className="w-full truncate rounded bg-background px-1.5 py-1 font-mono text-[11px] focus:outline-none"
            title="点击自动全选，可手动复制"
            aria-label="后端推送 SSH 公钥"
          />
        ) : pubkeyErr ? (
          <div className="text-[11px] text-destructive">⚠ {pubkeyErr}</div>
        ) : (
          <div className="text-[11px] text-muted-foreground">加载公钥中…</div>
        )}
        {copyFailed && (
          <div className="mt-1 text-[10px] text-destructive">
            浏览器自动复制被拒绝：公钥已自动全选，请按 Ctrl+C 手动复制
          </div>
        )}
        <div className="mt-1 text-[10px] leading-snug text-muted-foreground">
          首次推送前请把公钥添加到 GitLab「偏好设置 → SSH Keys」（账号级，添加一次即可推送所有仓库）
        </div>
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
        <div className="grid gap-1">
          <Label className="text-xs">提交信息（commit message）</Label>
          <Input
            className="h-8 text-xs"
            value={commitMsg}
            onChange={(e) => onSetCommitMsg(e.target.value)}
            placeholder="留空自动生成（语义库名+时间）"
          />
        </div>
        <div className="flex items-center gap-2 rounded border border-dashed px-2 py-1.5 border-muted">
          <input
            id="push-force"
            type="checkbox"
            checked={force}
            onChange={(e) => onSetForce(e.target.checked)}
            className="h-3.5 w-3.5"
          />
          <Label
            htmlFor="push-force"
            className={force ? "text-xs font-semibold text-amber-600" : "text-xs"}
          >
            强制覆盖远端（force push）
          </Label>
          {force && (
            <span className="text-[11px] text-amber-600">
              ⚠ 将覆盖远端同名分支/历史，请确认目标仓库
            </span>
          )}
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
