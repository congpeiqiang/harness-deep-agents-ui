"use client";

// 实验提交表单（两步向导）：
// 步骤 1「数据集与参数」= 数据集多选 + 条数上限 + judge 开关 + 门禁阈值；
// 步骤 2「对比臂」= 数据库下拉选一次（语义库版本合并区）→ 每臂独立指定
// prompt label / skill ref / 语义库 ref（空 = 默认）。
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { FlaskConical, Loader2, Plus, Trash2, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  fetchDatasets,
  fetchPromptLabels,
  fetchSkillRefs,
  fetchSemanticRefs,
  submitRun,
  type DatasetMeta,
  type PromptInfo,
  type GitRefs,
} from "@/lib/experiment";
// 数据库下拉与设置页「数据库」模块同源（listDatabases，带语义层/直连标记）
import { listDatabases, type DbInfo } from "@/lib/dbConfig";

// shadcn SelectItem value 不能为空串，用哨兵映射空（= 默认）
const PROMPT_DEFAULT = "__prod__";
const SKILL_DEFAULT = "__disk__";
const SEM_DEFAULT = "__sem_default__"; // 语义库版本 = 留空（当前服务版本）
const DB_NONE = "__no_db__"; // 数据库下拉 = 未指定（全部臂留空）

interface ArmDraft {
  name: string;
  prompt_label: string;
  skill_ref: string;
  semantic_ref: string;
}

function newArm(name: string): ArmDraft {
  return { name, prompt_label: "", skill_ref: "", semantic_ref: "" };
}

export default function ExperimentForm({
  onSubmitted,
  onCancel,
}: {
  onSubmitted: (stamp: string) => void;
  /** 返回工作台（丢弃本表单草稿） */
  onCancel: () => void;
}) {
  const [step, setStep] = useState<1 | 2>(1);

  const [datasets, setDatasets] = useState<DatasetMeta[]>([]);
  // 数据集加载态与空态原因分开：后端返回空数组 ≠ 加载中（此前空态误显示「加载中…」）
  const [dsLoading, setDsLoading] = useState(true);
  const [dsNote, setDsNote] = useState("");
  // 数据集默认全不选（此前默认勾 badcase，数据集未采集时提交/装载会 404 误导）。
  // 提交时下方校验：至少勾一个才允许继续。
  const [selDatasets, setSelDatasets] = useState<string[]>([]);
  const [limit, setLimit] = useState("");
  const [judge, setJudge] = useState(false);
  const [threshold, setThreshold] = useState("0.05");

  const [promptLabels, setPromptLabels] = useState<PromptInfo[]>([]);
  const [skillRefs, setSkillRefs] = useState<GitRefs>({ tags: [], branches: [], head: "" });
  const [arms, setArms] = useState<ArmDraft[]>([newArm("ref"), newArm("cand")]);
  const [submitting, setSubmitting] = useState(false);

  // 语义库版本配置（合并一处）：数据库下拉实验级选一次 → 自动加载该库 git refs，
  // 每臂的「语义库版本」下拉直接选 tag/branch（空 = 当前服务版本）
  const [dbOptions, setDbOptions] = useState<DbInfo[]>([]);
  const [semDb, setSemDb] = useState("");
  const [semRefs, setSemRefs] = useState<GitRefs | null>(null);
  const [loadingSem, setLoadingSem] = useState(false);

  // 数据集多选下拉展开态
  const [dsOpen, setDsOpen] = useState(false);

  // 数据集列表：独立加载/重载（空数组 = 暂无数据集，给空态 + note，不再误显示加载中）
  const loadDatasets = useCallback(async () => {
    setDsLoading(true);
    try {
      const res = await fetchDatasets();
      setDatasets(res.datasets);
      setDsNote(res.note ?? "");
    } catch (e) {
      setDatasets([]);
      setDsNote(e instanceof Error ? `加载失败：${e.message}` : "加载失败");
    } finally {
      setDsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDatasets();
    Promise.all([fetchPromptLabels(), fetchSkillRefs()])
      .then(([pl, sr]) => {
        setPromptLabels(pl);
        setSkillRefs(sr);
      })
      .catch((e) =>
        toast.error(`拉取元数据失败: ${e instanceof Error ? e.message : String(e)}`)
      );
  }, [loadDatasets]);

  // 语义库版本的数据库下拉：与设置页数据库模块同源。
  // 数据库在设置里新增/删除、或切换工作区后刷新（与 DatabaseSelector 一致）。
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const list = await listDatabases();
        if (alive) setDbOptions(list);
      } catch (e) {
        console.error("[EXPERIMENT] 拉取数据库列表失败:", e);
      }
    };
    load();
    const onChanged = () => load();
    window.addEventListener("databases-changed", onChanged);
    window.addEventListener("workspace-changed", onChanged);
    return () => {
      alive = false;
      window.removeEventListener("databases-changed", onChanged);
      window.removeEventListener("workspace-changed", onChanged);
    };
  }, []);

  const labelOptions = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const p of promptLabels) {
      for (const lb of p.labels ?? []) {
        if (!seen.has(lb)) {
          seen.add(lb);
          out.push(lb);
        }
      }
    }
    return out;
  }, [promptLabels]);

  const skillOptions = useMemo(() => {
    const out: string[] = [];
    for (const t of [...skillRefs.tags, ...skillRefs.branches]) {
      if (!out.includes(t)) out.push(t);
    }
    if (skillRefs.head && !out.includes(skillRefs.head)) out.push(skillRefs.head);
    return out;
  }, [skillRefs]);

  // 选库（实验级全局一次）→ 自动加载该库语义库 git refs，各臂下拉直接选版本
  const onSelectSemDb = useCallback(async (db: string) => {
    setSemDb(db);
    // 换库后旧 db=ref 作废：各臂全部回退默认（当前服务版本）
    setArms((prev) => prev.map((a) => ({ ...a, semantic_ref: "" })));
    setSemRefs(null);
    if (!db) return;
    setLoadingSem(true);
    try {
      const refs = await fetchSemanticRefs(db);
      setSemRefs(refs);
      if ((refs.tags?.length ?? 0) === 0 && (refs.branches?.length ?? 0) === 0) {
        toast.info(`「${db}」暂无可用 git refs，各臂将使用当前服务版本`);
      }
    } catch (e) {
      setSemRefs(null);
      toast.error(`拉取「${db}」语义库 refs 失败: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoadingSem(false);
    }
  }, []);

  // 可选版本总数（tags + branches；HEAD 仅展示，留空即当前服务版本）
  const semVersionCount =
    (semRefs?.tags?.length ?? 0) + (semRefs?.branches?.length ?? 0);

  const setArm = (i: number, patch: Partial<ArmDraft>) => {
    setArms((prev) => prev.map((a, j) => (j === i ? { ...a, ...patch } : a)));
  };

  const onAddArm = () => {
    setArms((prev) => [...prev, newArm(`arm${prev.length + 1}`)]);
  };

  const onRemoveArm = (i: number) =>
    setArms((prev) => (prev.length <= 1 ? prev : prev.filter((_, j) => j !== i)));

  const goNext = () => {
    if (selDatasets.length === 0) {
      toast.error("至少选择一个数据集");
      return;
    }
    setDsOpen(false);
    setStep(2);
  };

  const onSubmit = async () => {
    if (selDatasets.length === 0) {
      toast.error("至少选择一个数据集");
      return;
    }
    if (arms.length === 0) {
      toast.error("至少配置一个臂");
      return;
    }
    const names = arms.map((a) => a.name.trim());
    if (names.some((n) => !n)) {
      toast.error("臂名不能为空");
      return;
    }
    if (new Set(names).size !== names.length) {
      toast.error("臂名需唯一");
      return;
    }
    setSubmitting(true);
    try {
      const th = parseFloat(threshold);
      const resp = await submitRun({
        datasets: selDatasets,
        dataset_limit: limit.trim() ? parseInt(limit, 10) : 0,
        judge,
        threshold: Number.isFinite(th) ? th : 0.05,
        arms: arms.map((a) => ({
          name: a.name.trim(),
          prompt_label: a.prompt_label || "",
          skill_ref: a.skill_ref || "",
          semantic_ref: a.semantic_ref || "",
        })),
      });
      toast.success("实验已提交，开始后台运行");
      onSubmitted(resp.stamp);
    } catch (e) {
      toast.error(`提交失败: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSubmitting(false);
    }
  };

  const toggleDataset = (name: string) =>
    setSelDatasets((prev) =>
      prev.includes(name) ? prev.filter((d) => d !== name) : [...prev, name]
    );

  // 数据集多选块（步骤 1 内容）
  const datasetPicker = (
    <>
      <span className="mb-1 block text-xs text-muted-foreground">
        数据集（多选 · Langfuse 全部 Datasets）
      </span>
      <button
        type="button"
        onClick={() => setDsOpen((v) => !v)}
        className="flex h-9 w-full items-center justify-between rounded-md border border-input bg-background px-3 text-sm"
      >
        <span className="truncate">
          {selDatasets.length === 0 ? "未选择数据集" : `${selDatasets.length} 个已选`}
        </span>
        <ChevronDown
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform",
            dsOpen && "rotate-180"
          )}
        />
      </button>
      {dsOpen && (
        <>
          {/* 点击外部关闭 */}
          <div className="fixed inset-0 z-10" onClick={() => setDsOpen(false)} />
          <div className="absolute left-0 right-0 z-20 mt-1 max-h-64 overflow-y-auto rounded-md border border-border bg-background p-1 shadow-md">
            {datasets.length === 0 ? (
              dsLoading ? (
                <p className="p-2 text-xs text-muted-foreground">加载中…</p>
              ) : (
                <div className="space-y-1 p-2">
                  <p className="text-xs font-medium text-muted-foreground">暂无可用数据集</p>
                  {dsNote ? (
                    <p className="text-[11px] leading-snug text-muted-foreground/80">{dsNote}</p>
                  ) : null}
                  <button
                    type="button"
                    onClick={loadDatasets}
                    className="mt-1 rounded border px-2 py-0.5 text-xs hover:bg-accent"
                  >
                    刷新
                  </button>
                </div>
              )
            ) : (
              datasets.map((d) => {
                const active = selDatasets.includes(d.name);
                return (
                  <div
                    key={d.name}
                    onClick={() => toggleDataset(d.name)}
                    className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent"
                  >
                    <input
                      type="checkbox"
                      checked={active}
                      readOnly
                      className="pointer-events-none size-4 accent-foreground"
                    />
                    <span className="min-w-0 flex-1 truncate">{d.name}</span>
                    <span
                      className={cn(
                        "shrink-0 font-mono text-xs",
                        d.count >= 0 ? "text-muted-foreground" : "text-amber-600"
                      )}
                      title={d.error ? `读取失败: ${d.error}` : undefined}
                    >
                      {d.count >= 0 ? d.count : "?"}
                    </span>
                  </div>
                );
              })
            )}
            <div className="mt-1 flex items-center justify-between border-t border-border px-1 pt-1.5">
              <button
                type="button"
                onClick={() => setSelDatasets([])}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                清空
              </button>
              <span className="text-xs text-muted-foreground">
                已选 {selDatasets.length}
              </span>
            </div>
          </div>
        </>
      )}
    </>
  );

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4">
      {/* 步骤条 */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card px-4 py-2.5 shadow-sm">
        {([1, 2] as const).map((n) => (
          <div key={n} className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => n < step && setStep(n)}
              disabled={n >= step || submitting}
              className={cn(
                "flex items-center gap-1.5 text-sm",
                step === n
                  ? "font-semibold text-foreground"
                  : n < step
                    ? "cursor-pointer text-muted-foreground hover:text-foreground"
                    : "text-muted-foreground"
              )}
              title={n < step ? "返回该步骤（已填内容保留）" : undefined}
            >
              <span
                className={cn(
                  "flex size-5 items-center justify-center rounded-full text-[11px] font-semibold",
                  step === n
                    ? "bg-foreground text-background"
                    : "bg-muted text-muted-foreground"
                )}
              >
                {n}
              </span>
              {n === 1 ? "数据集与参数" : "对比臂"}
            </button>
            {n === 1 && <span className="text-muted-foreground/50">→</span>}
          </div>
        ))}
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto text-muted-foreground"
          onClick={onCancel}
          disabled={submitting}
        >
          取消
        </Button>
      </div>

      {/* 步骤 1：数据集与参数 */}
      {step === 1 && (
        <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
          <div className="space-y-4">
            <div className="relative">{datasetPicker}</div>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="mb-1 block text-xs text-muted-foreground">
                  条数上限（0 = 全部）
                </span>
                <Input
                  className="h-9 text-sm"
                  value={limit}
                  onChange={(e) => setLimit(e.target.value.replace(/\D/g, ""))}
                  placeholder="0"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs text-muted-foreground">门禁阈值（±）</span>
                <Input
                  className="h-9 text-sm"
                  value={threshold}
                  onChange={(e) => setThreshold(e.target.value)}
                  placeholder="0.05"
                />
              </label>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={judge} onCheckedChange={setJudge} />
              启用 LLM 判分（sql_biz_correct_score，更慢）
            </label>
          </div>
          <div className="mt-5 flex justify-end">
            <Button onClick={goNext}>下一步：配置对比臂</Button>
          </div>
        </div>
      )}

      {/* 步骤 2：对比臂 */}
      {step === 2 && (
        <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] text-muted-foreground">
              未指定的维度走默认：生产 prompt / 当前磁盘 skill / 当前语义库 HEAD。
              建议：第一臂为基准（ref），后续臂为候选版本。
            </p>
            <Button variant="outline" size="sm" onClick={onAddArm} className="shrink-0">
              <Plus className="mr-1.5 size-3.5" />
              添加臂
            </Button>
          </div>

          {/* 语义库版本（合并一处）：数据库下拉实验级选一次 → 自动加载该库 git refs，
              每臂下拉选版本；原独立「语义库 refs 速查」折叠面板已并入此区 */}
          <div className="mt-3 rounded-md border border-dashed border-border bg-muted/20 p-2.5">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-muted-foreground">
                数据库
                <span className="font-normal">
                  （选择后加载该库可用的语义库版本，供各臂下拉选择）
                </span>
              </span>
              <Select
                value={semDb || DB_NONE}
                onValueChange={(v) => onSelectSemDb(v === DB_NONE ? "" : v)}
              >
                <SelectTrigger className="h-9 w-full gap-2 bg-background text-sm">
                  <SelectValue placeholder="选择数据库">
                    {semDb ? undefined : (
                      <span className="text-muted-foreground">选择数据库</span>
                    )}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent className="max-h-64 min-w-[240px]">
                  <SelectItem value={DB_NONE} className="text-sm">
                    未指定
                  </SelectItem>
                  {dbOptions.length === 0 && (
                    <SelectItem
                      value="__no_dbs__"
                      className="text-sm text-muted-foreground"
                      disabled
                    >
                      暂无数据库（请先在设置中配置）
                    </SelectItem>
                  )}
                  {dbOptions.map((d) => (
                    <SelectItem key={d.name} value={d.name} className="text-sm">
                      {d.name} ({String(d.db_type || "mysql").toUpperCase()}
                      {d.semantic ? ", 语义层" : ", 直连"})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
              {loadingSem ? (
                <>
                  <Loader2 className="size-3.5 animate-spin" />
                  加载 refs…
                </>
              ) : semDb ? (
                semVersionCount > 0 ? (
                  <span>
                    共 {semVersionCount} 个可选版本
                    {semRefs?.head ? (
                      <span className="ml-1 font-mono text-[10px]">
                        · HEAD {semRefs.head}
                      </span>
                    ) : null}
                  </span>
                ) : (
                  <span>该库暂无可用 git refs</span>
                )
              ) : (
                <span>未选库时，各臂语义库版本将使用当前服务版本</span>
              )}
            </div>
          </div>

          {/* 臂卡列表 */}
          <div className="mt-3 space-y-3">
            {arms.map((arm, i) => (
              <div key={i} className="rounded-md border border-border p-3">
                <div className="flex items-center gap-2">
                  <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                    #{i + 1}
                  </span>
                  <Input
                    className="h-8 w-32 text-sm font-medium"
                    value={arm.name}
                    onChange={(e) => setArm(i, { name: e.target.value })}
                    placeholder="臂名"
                  />
                  {arms.length > 1 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="ml-auto h-7 w-7 p-0 text-muted-foreground"
                      onClick={() => onRemoveArm(i)}
                      title="删除此臂"
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  )}
                </div>
                <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
                  {/* prompt label */}
                  <label className="block">
                    <span className="mb-1 block text-xs text-muted-foreground">
                      Prompt 版本
                    </span>
                    <Select
                      value={arm.prompt_label ? arm.prompt_label : PROMPT_DEFAULT}
                      onValueChange={(v) =>
                        setArm(i, { prompt_label: v === PROMPT_DEFAULT ? "" : v })
                      }
                    >
                      <SelectTrigger className="h-8 text-sm">
                        <SelectValue placeholder="生产默认" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={PROMPT_DEFAULT} className="text-sm">
                          生产默认（production）
                        </SelectItem>
                        {labelOptions.map((lb) => (
                          <SelectItem key={lb} value={lb} className="text-sm">
                            {lb}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </label>
                  {/* skill ref */}
                  <label className="block">
                    <span className="mb-1 block text-xs text-muted-foreground">
                      Skill 版本
                    </span>
                    <Select
                      value={arm.skill_ref ? arm.skill_ref : SKILL_DEFAULT}
                      onValueChange={(v) =>
                        setArm(i, { skill_ref: v === SKILL_DEFAULT ? "" : v })
                      }
                    >
                      <SelectTrigger className="h-8 text-sm">
                        <SelectValue placeholder="当前磁盘" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={SKILL_DEFAULT} className="text-sm">
                          当前磁盘 skill
                        </SelectItem>
                        {skillOptions.map((s) => (
                          <SelectItem key={s} value={s} className="text-sm font-mono">
                            {s}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {skillRefs.note && skillOptions.length === 0 && (
                      <p className="mt-1 text-xs text-amber-600">{skillRefs.note}</p>
                    )}
                  </label>
                  {/* semantic ref（版本下拉；库在实验级选一次） */}
                  <label className="block">
                    <span className="mb-1 block text-xs text-muted-foreground">
                      语义库版本
                    </span>
                    <Select
                      value={arm.semantic_ref || SEM_DEFAULT}
                      onValueChange={(v) =>
                        setArm(i, { semantic_ref: v === SEM_DEFAULT ? "" : v })
                      }
                      disabled={!semDb || loadingSem || semVersionCount === 0}
                    >
                      {/* disabled 需 Root 与 Trigger 双处设置，否则视觉可点但打不开 */}
                      <SelectTrigger
                        className="h-8 text-sm"
                        disabled={!semDb || loadingSem || semVersionCount === 0}
                      >
                        <SelectValue placeholder="当前服务版本" />
                      </SelectTrigger>
                      <SelectContent className="max-h-64">
                        <SelectItem value={SEM_DEFAULT} className="text-sm">
                          当前服务版本（留空）
                        </SelectItem>
                        {(semRefs?.tags ?? []).map((t) => (
                          <SelectItem
                            key={`tag-${t}`}
                            value={`${semDb}=${t}`}
                            className="text-sm font-mono"
                          >
                            tag {t}
                          </SelectItem>
                        ))}
                        {(semRefs?.branches ?? []).map((b) => (
                          <SelectItem
                            key={`branch-${b}`}
                            value={`${semDb}=${b}`}
                            className="text-sm font-mono"
                          >
                            branch {b}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="mt-1 truncate text-[11px] text-muted-foreground">
                      {!semDb
                        ? "未选库 → 用当前服务版本"
                        : loadingSem
                          ? "加载版本列表…"
                          : arm.semantic_ref
                            ? `锁定 ${arm.semantic_ref}`
                            : "留空 = 当前服务版本"}
                    </p>
                  </label>
                </div>
              </div>
            ))}
          </div>

          {/* 底部操作 */}
          <div className="mt-5 flex items-center justify-between">
            <Button variant="outline" onClick={() => setStep(1)} disabled={submitting}>
              上一步
            </Button>
            <Button size="lg" onClick={() => void onSubmit()} disabled={submitting}>
              {submitting ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <FlaskConical className="mr-2 size-4" />
              )}
              {submitting ? "提交中…" : "运行离线实验"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
