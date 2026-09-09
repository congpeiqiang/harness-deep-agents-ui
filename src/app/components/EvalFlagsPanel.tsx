"use client";

/**
 * 在线评估开关面板（设置 → 评估）
 *
 * 后端: src/api/eval_flags.py（覆盖层落盘 {AGENT_DATA_ROOT}/shared/eval_flags.json）。
 * 改动即时生效（评估器读时求值），无需重启后端；每个开关可单独「恢复默认」。
 */
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  EVAL_FLAG_LABELS,
  getEvalFlags,
  isFlagOn,
  resetEvalFlags,
  saveEvalFlags,
  type EvalFlagMap,
} from "@/lib/evalFlags";

const SOURCE_TEXT: Record<string, string> = {
  override: "界面覆盖",
  env: ".env",
  default: "代码默认",
};

interface RowProps {
  flagKey: string;
  desc: string;
  flags: EvalFlagMap | null;
  disabled?: boolean;
  busy: boolean;
  onToggle: (key: string, on: boolean) => void;
  onResetOne: (key: string) => void;
  children?: React.ReactNode;
}

function FlagRow({
  flagKey,
  desc,
  flags,
  disabled,
  busy,
  onToggle,
  onResetOne,
  children,
}: RowProps) {
  const item = flags?.[flagKey];
  const source = item ? SOURCE_TEXT[item.source] ?? item.source : "…";
  const overridden = item?.source === "override";
  return (
    <div className="flex items-start justify-between gap-4 rounded-md border border-border p-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{EVAL_FLAG_LABELS[flagKey] ?? flagKey}</span>
          <span
            className={
              "rounded px-1.5 py-0.5 text-[11px] " +
              (overridden
                ? "bg-primary/10 text-primary"
                : "bg-muted text-muted-foreground")
            }
          >
            来源：{source}
          </span>
          {overridden && (
            <button
              type="button"
              disabled={busy}
              onClick={() => onResetOne(flagKey)}
              className="text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline disabled:opacity-50"
            >
              恢复默认
            </button>
          )}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{desc}</p>
        <p className="mt-1 font-mono text-[11px] text-muted-foreground">
          {flagKey}
          {item ? ` = ${item.value}` : ""}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2 pt-0.5">
        {children ?? (
          <Switch
            checked={isFlagOn(item)}
            disabled={disabled || busy || !flags}
            onCheckedChange={(v) => onToggle(flagKey, v)}
          />
        )}
      </div>
    </div>
  );
}

export function EvalFlagsPanel({ active }: { active?: boolean }) {
  const [flags, setFlags] = useState<EvalFlagMap | null>(null);
  const [sampleText, setSampleText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    try {
      const r = await getEvalFlags();
      setFlags(r.flags);
      setSampleText(r.flags.NL2SQL_EVAL_JUDGE_SAMPLE?.value ?? "");
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    if (active) void load();
  }, [active, load]);

  const apply = useCallback(
    async (patch: Record<string, string>, okNote: string) => {
      setBusy(true);
      setNote("");
      try {
        const r = await saveEvalFlags(patch);
        setFlags(r.flags);
        setSampleText(r.flags.NL2SQL_EVAL_JUDGE_SAMPLE?.value ?? "");
        setError("");
        setNote(okNote);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    []
  );

  const onToggle = (key: string, on: boolean) =>
    void apply({ [key]: on ? "1" : "0" }, "已保存并生效（无需重启后端）");

  const onResetOne = (key: string) =>
    void apply({ [key]: "" }, "已恢复为 .env / 默认值");

  const onResetAll = async () => {
    setBusy(true);
    setNote("");
    try {
      const r = await resetEvalFlags();
      setFlags(r.flags);
      setSampleText(r.flags.NL2SQL_EVAL_JUDGE_SAMPLE?.value ?? "");
      setError("");
      setNote("已清空界面覆盖，全部回到 .env / 默认值");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onSaveSample = () => {
    const raw = sampleText.trim();
    const num = Number(raw);
    if (!raw || Number.isNaN(num) || num < 0 || num > 1) {
      setError("采样率需为 0~1 之间的数字");
      return;
    }
    void apply({ NL2SQL_EVAL_JUDGE_SAMPLE: String(num) }, "采样率已保存并生效");
  };

  const masterOff = flags ? !isFlagOn(flags.NL2SQL_EVAL_ENABLED) : false;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-4">
        <p className="text-xs text-muted-foreground">
          控制在线评估器（确定性打分 / LLM-judge / 评估单元落盘）。改动即时生效，
          <span className="font-medium text-foreground">无需重启后端</span>
          ；界面只覆盖被改过的项，其余继续跟随 .env。评估关闭后，依赖分数阈值的
          badcase 采集与反馈门禁会空跑。
        </p>
        <Button variant="outline" size="sm" disabled={busy} onClick={onResetAll}>
          全部恢复默认
        </Button>
      </div>

      {masterOff && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
          总开关已关闭：所有评估器停用（确定性分不写、LLM-judge 不入队、评估单元不落盘）。
          下方各项开关此时不生效。
        </p>
      )}

      <FlagRow
        flagKey="NL2SQL_EVAL_ENABLED"
        desc="关闭 = 全部评估器停用（确定性分不写 + LLM-judge 不入队 + 评估单元不落盘）。"
        flags={flags}
        busy={busy}
        onToggle={onToggle}
        onResetOne={onResetOne}
      />

      <FlagRow
        flagKey="NL2SQL_EVAL_JUDGE_ENABLED"
        desc="关闭 = 只停 LLM 打分（sql_biz_correct / 报告三维），省 token；零成本确定性维度照常。"
        flags={flags}
        busy={busy}
        disabled={masterOff}
        onToggle={onToggle}
        onResetOne={onResetOne}
      />

      <FlagRow
        flagKey="NL2SQL_EVAL_JUDGE_SAMPLE"
        desc="LLM-judge 采样率（0~1），仅 judge 开关开启时生效。"
        flags={flags}
        busy={busy}
        onToggle={onToggle}
        onResetOne={onResetOne}
      >
        <Input
          className="w-24"
          value={sampleText}
          disabled={busy || !flags}
          onChange={(e) => setSampleText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onSaveSample();
          }}
        />
        <Button size="sm" disabled={busy || !flags} onClick={onSaveSample}>
          保存
        </Button>
      </FlagRow>

      <FlagRow
        flagKey="NL2SQL_EVAL_SUBJECT"
        desc="关闭 = 不落评估单元 sidecar（证据 + 组装文件）。"
        flags={flags}
        busy={busy}
        disabled={masterOff}
        onToggle={onToggle}
        onResetOne={onResetOne}
      />

      {error && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </p>
      )}
      {note && !error && (
        <p className="text-xs text-muted-foreground">{note}</p>
      )}
    </div>
  );
}
