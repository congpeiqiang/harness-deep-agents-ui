"use client";

// 实验提交表单：数据集多选 + 条数上限 + judge 开关 + 门禁阈值 +
// 动态 arm 列表（每臂独立指定 prompt label / skill ref / 语义库 ref，空 = 默认）。
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  FlaskConical,
  Loader2,
  Plus,
  Trash2,
  ChevronDown,
  Database,
} from "lucide-react";
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

// shadcn SelectItem value 不能为空串，用哨兵映射空（= 默认）
const PROMPT_DEFAULT = "__prod__";
const SKILL_DEFAULT = "__disk__";

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
}: {
  onSubmitted: (stamp: string) => void;
}) {
  const [datasets, setDatasets] = useState<DatasetMeta[]>([]);
  const [selDatasets, setSelDatasets] = useState<string[]>(["badcase"]);
  const [limit, setLimit] = useState("");
  const [judge, setJudge] = useState(false);
  const [threshold, setThreshold] = useState("0.05");

  const [promptLabels, setPromptLabels] = useState<PromptInfo[]>([]);
  const [skillRefs, setSkillRefs] = useState<GitRefs>({ tags: [], branches: [], head: "" });
  const [arms, setArms] = useState<ArmDraft[]>([newArm("ref"), newArm("cand")]);
  const [submitting, setSubmitting] = useState(false);

  // 语义库 refs 速查（按库加载 → 点击填入当前行）
  const [semDb, setSemDb] = useState("");
  const [semRefs, setSemRefs] = useState<GitRefs | null>(null);
  const [loadingSem, setLoadingSem] = useState(false);

  // 折叠区：数据集与参数 / 对比臂（交互参考「语义库 refs 速查」，默认折叠）
  const [openData, setOpenData] = useState(false);
  const [openArms, setOpenArms] = useState(false);

  // 数据集多选下拉展开态
  const [dsOpen, setDsOpen] = useState(false);

  useEffect(() => {
    Promise.all([fetchDatasets(), fetchPromptLabels(), fetchSkillRefs()])
      .then(([ds, pl, sr]) => {
        setDatasets(ds);
        setPromptLabels(pl);
        setSkillRefs(sr);
      })
      .catch((e) =>
        toast.error(`拉取元数据失败: ${e instanceof Error ? e.message : String(e)}`)
      );
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

  const loadSemanticRefs = useCallback(async () => {
    const db = semDb.trim();
    if (!db) {
      toast.error("请先填写数据库名（如 chinook_aliyun）");
      return;
    }
    setLoadingSem(true);
    try {
      const refs = await fetchSemanticRefs(db);
      setSemRefs(refs);
    } catch (e) {
      setSemRefs(null);
      toast.error(`拉取语义库 refs 失败: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoadingSem(false);
    }
  }, [semDb]);

  const setArm = (i: number, patch: Partial<ArmDraft>) => {
    setArms((prev) => prev.map((a, j) => (j === i ? { ...a, ...patch } : a)));
  };

  const onAddArm = () => {
    setOpenArms(true); // 添加后自动展开，保证新臂可见
    setArms((prev) => [...prev, newArm(`arm${prev.length + 1}`)]);
  };

  const onRemoveArm = (i: number) =>
    setArms((prev) => (prev.length <= 1 ? prev : prev.filter((_, j) => j !== i)));

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

  return (
    <div className="space-y-4">
      {/* 数据集 + 参数 */}
      <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
        <button
          onClick={() => setOpenData((v) => !v)}
          className="flex w-full items-center justify-between text-sm font-medium"
        >
          数据集与参数
          <ChevronDown
            className={cn(
              "size-4 text-muted-foreground transition-transform",
              !openData && "-rotate-90"
            )}
          />
        </button>
        {openData && (
          <>
            <div className="relative mt-2 block">
              <span className="mb-1 block text-xs text-muted-foreground">
                数据集（多选 · Langfuse 全部 Datasets）
              </span>
              <button
                type="button"
                onClick={() => setDsOpen((v) => !v)}
                className="flex h-8 w-full items-center justify-between rounded-md border border-input bg-background px-3 text-xs"
              >
                <span className="truncate">
                  {selDatasets.length === 0 ? "未选择数据集" : `${selDatasets.length} 个已选`}
                </span>
                <ChevronDown
                  className={cn(
                    "size-3.5 shrink-0 text-muted-foreground transition-transform",
                    dsOpen && "rotate-180"
                  )}
                />
              </button>
              {dsOpen && (
                <>
                  {/* 点击外部关闭 */}
                  <div className="fixed inset-0 z-10" onClick={() => setDsOpen(false)} />
                  <div className="absolute left-0 right-0 z-20 mt-1 max-h-60 overflow-y-auto rounded-md border border-border bg-background p-1 shadow-md">
                    {datasets.length === 0 ? (
                      <p className="p-2 text-xs text-muted-foreground">加载中…</p>
                    ) : (
                      datasets.map((d) => {
                        const active = selDatasets.includes(d.name);
                        return (
                          <div
                            key={d.name}
                            onClick={() => toggleDataset(d.name)}
                            className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-accent"
                          >
                            <input
                              type="checkbox"
                              checked={active}
                              readOnly
                              className="pointer-events-none size-3.5 accent-foreground"
                            />
                            <span className="min-w-0 flex-1 truncate">{d.name}</span>
                            <span
                              className={cn(
                                "shrink-0 font-mono text-[10px]",
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
                        className="text-[10px] text-muted-foreground hover:text-foreground"
                      >
                        清空
                      </button>
                      <span className="text-[10px] text-muted-foreground">
                        已选 {selDatasets.length}
                      </span>
                    </div>
                  </div>
                </>
              )}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <label className="block">
                <span className="mb-1 block text-xs text-muted-foreground">
                  条数上限（0 = 全部）
                </span>
                <Input
                  className="h-8 text-xs"
                  value={limit}
                  onChange={(e) => setLimit(e.target.value.replace(/\D/g, ""))}
                  placeholder="0"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs text-muted-foreground">门禁阈值（±）</span>
                <Input
                  className="h-8 text-xs"
                  value={threshold}
                  onChange={(e) => setThreshold(e.target.value)}
                  placeholder="0.05"
                />
              </label>
            </div>
            <label className="mt-3 flex items-center gap-2 text-xs">
              <Switch checked={judge} onCheckedChange={setJudge} />
              启用 LLM 判分（sql_biz_correct_score，更慢）
            </label>
          </>
        )}
      </div>

      {/* arm 列表 */}
      <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
        <div className="flex items-center justify-between">
          <button
            onClick={() => setOpenArms((v) => !v)}
            className="flex flex-1 items-center justify-between text-sm font-medium"
          >
            对比臂（每臂可独立指定版本）
            <ChevronDown
              className={cn(
                "size-4 text-muted-foreground transition-transform",
                !openArms && "-rotate-90"
              )}
            />
          </button>
          <Button variant="outline" size="sm" onClick={onAddArm}>
            <Plus className="mr-1.5 size-3.5" />
            添加臂
          </Button>
        </div>
        {openArms && (
          <>
            <p className="mt-1 text-[11px] text-muted-foreground">
              未指定的维度走默认：生产 prompt / 当前磁盘 skill / 当前语义库 HEAD。
              建议：第一臂为基准（ref），后续臂为候选版本。
            </p>
            <div className="mt-3 space-y-3">
              {arms.map((arm, i) => (
                <div key={i} className="rounded-md border border-border p-3">
                  <div className="flex items-center gap-2">
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                      #{i + 1}
                    </span>
                    <Input
                      className="h-8 w-32 text-xs font-medium"
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
                      <span className="mb-1 block text-[10px] text-muted-foreground">
                        Prompt 版本
                      </span>
                      <Select
                        value={arm.prompt_label ? arm.prompt_label : PROMPT_DEFAULT}
                        onValueChange={(v) =>
                          setArm(i, { prompt_label: v === PROMPT_DEFAULT ? "" : v })
                        }
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue placeholder="生产默认" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={PROMPT_DEFAULT} className="text-xs">
                            生产默认（production）
                          </SelectItem>
                          {labelOptions.map((lb) => (
                            <SelectItem key={lb} value={lb} className="text-xs">
                              {lb}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </label>
                    {/* skill ref */}
                    <label className="block">
                      <span className="mb-1 block text-[10px] text-muted-foreground">
                        Skill 版本
                      </span>
                      <Select
                        value={arm.skill_ref ? arm.skill_ref : SKILL_DEFAULT}
                        onValueChange={(v) =>
                          setArm(i, { skill_ref: v === SKILL_DEFAULT ? "" : v })
                        }
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue placeholder="当前磁盘" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={SKILL_DEFAULT} className="text-xs">
                            当前磁盘 skill
                          </SelectItem>
                          {skillOptions.map((s) => (
                            <SelectItem key={s} value={s} className="text-xs font-mono">
                              {s}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {skillRefs.note && skillOptions.length === 0 && (
                        <p className="mt-1 text-[10px] text-amber-600">{skillRefs.note}</p>
                      )}
                    </label>
                    {/* semantic ref */}
                    <label className="block">
                      <span className="mb-1 block text-[10px] text-muted-foreground">
                        语义库版本（可留空）
                      </span>
                      <Input
                        className="h-8 font-mono text-xs"
                        value={arm.semantic_ref}
                        onChange={(e) => setArm(i, { semantic_ref: e.target.value })}
                        placeholder="db=ref 或 ref"
                      />
                    </label>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* 语义库 refs 速查（可选） */}
      <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
        <button
          onClick={() =>
            setSemRefs((prev) =>
              prev === null ? { tags: [], branches: [], head: "" } : null
            )
          }
          className="flex w-full items-center justify-between text-sm font-medium"
        >
          语义库 refs 速查
          <ChevronDown className="size-4 text-muted-foreground" />
        </button>
        {semRefs !== null && (
          <div className="mt-2">
            <div className="flex items-center gap-2">
              <Input
                className="h-8 w-48 font-mono text-xs"
                value={semDb}
                onChange={(e) => setSemDb(e.target.value)}
                placeholder="数据库名"
              />
              <Button variant="outline" size="sm" onClick={loadSemanticRefs} disabled={loadingSem}>
                {loadingSem ? (
                  <Loader2 className="mr-1 size-3.5 animate-spin" />
                ) : (
                  <Database className="mr-1 size-3.5" />
                )}
                加载
              </Button>
              <span className="text-[11px] text-muted-foreground">
                提示：格式 db=ref（如 chinook_aliyun=v6.0.0）
              </span>
            </div>
            {loadingSem ? (
              <p className="mt-2 text-xs text-muted-foreground">加载中…</p>
            ) : (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {(semRefs?.tags ?? []).map((t) => (
                  <button
                    key={t}
                    onClick={() => {
                      const db = semDb.trim();
                      setArms((prev) =>
                        prev.map((a) => ({
                          ...a,
                          semantic_ref: db ? `${db}=${t}` : t,
                        }))
                      );
                      toast.success(`已填入所有臂：${db ? `${db}=` : ""}${t}`);
                    }}
                    className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground hover:bg-accent"
                  >
                    {t}
                  </button>
                ))}
                {(semRefs?.branches ?? []).map((b) => (
                  <button
                    key={b}
                    onClick={() => {
                      const db = semDb.trim();
                      setArms((prev) =>
                        prev.map((a) => ({
                          ...a,
                          semantic_ref: db ? `${db}=${b}` : b,
                        }))
                      );
                      toast.success(`已填入所有臂：${db ? `${db}=` : ""}${b}`);
                    }}
                    className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground hover:bg-accent"
                  >
                    {b}
                  </button>
                ))}
                {semRefs?.head && (
                  <span className="self-center text-[10px] text-muted-foreground">
                    HEAD: {semRefs.head}
                  </span>
                )}
                {(semRefs?.tags?.length ?? 0) === 0 &&
                  (semRefs?.branches?.length ?? 0) === 0 && (
                    <p className="text-xs text-muted-foreground">
                      该库无 tags/branches（可能未建模或无 git 仓库）
                    </p>
                  )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 提交 */}
      <Button className="w-full" size="lg" onClick={onSubmit} disabled={submitting}>
        {submitting ? (
          <Loader2 className="mr-2 size-4 animate-spin" />
        ) : (
          <FlaskConical className="mr-2 size-4" />
        )}
        {submitting ? "提交中…" : "运行离线实验"}
      </Button>
    </div>
  );
}
