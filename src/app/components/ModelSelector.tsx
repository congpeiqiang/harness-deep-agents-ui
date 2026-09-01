"use client";

import { useCallback, useEffect, useState } from "react";
import { listModelConfigs, type ModelProviderInfo } from "@/lib/modelConfigs";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// 选中的模型：provider 用于 llm_route 路由（api_key/base_url），modelId 用于 llm_model（具体模型）
export interface ModelSelection {
  provider: string;
  modelId: string;
}

interface Props {
  // 当前选中模型 id；空串 = 跟随激活 provider 的默认模型（不发送 llm_route/llm_model）
  value: string;
  // 当前选中模型所属 provider（用于区分同名模型 id）；空串 = 未指定
  provider?: string;
  onChange: (sel: ModelSelection) => void;
}

interface ModelOption {
  provider: string;
  modelId: string;
}

export function ModelSelector({ value, provider, onChange }: Props) {
  const [providers, setProviders] = useState<ModelProviderInfo[]>([]);
  const [activeName, setActiveName] = useState("");
  const [error, setError] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const r = await listModelConfigs();
      setProviders(r.providers);
      setActiveName(r.active);
      setError(false);
    } catch (e) {
      // 后端未重启/不可用时静默降级：只显示「默认模型」选项
      console.error("[MODEL_SELECT] 拉取模型配置列表失败:", e);
      setProviders([]);
      setActiveName("");
      setError(true);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // ModelConfigDialog 保存/删除/激活后刷新（ChatInterface 在 onChanged 里派发）
  useEffect(() => {
    const onConfigsChanged = () => refresh();
    window.addEventListener("model-configs-changed", onConfigsChanged);
    return () => window.removeEventListener("model-configs-changed", onConfigsChanged);
  }, [refresh]);

  // 全部模型（扁平，含所属 provider）
  const modelOptions: ModelOption[] = providers.flatMap((p) =>
    (p.models || [])
      .filter((m) => m.id)
      .map((m) => ({ provider: p.name, modelId: m.id }))
  );

  // option value 格式：provider:modelId（避免不同 provider 同名模型 id 冲突）
  const optionValue = (o: ModelOption) => `${o.provider}:${o.modelId}`;
  const parseOptionValue = (v: string): ModelOption | undefined => {
    const idx = v.indexOf(":");
    if (idx === -1) return undefined;
    return { provider: v.slice(0, idx), modelId: v.slice(idx + 1) };
  };

  // 激活 provider 的默认模型 id（空串 = 跟随激活 provider 时的显示值）
  const activeProvider = providers.find((p) => p.name === activeName) || providers[0];
  const activeDefaultModelId = (() => {
    if (!activeProvider) return "";
    const def = activeProvider.default_model;
    if (def && (activeProvider.models || []).some((m) => m.id === def)) return def;
    return activeProvider.models?.[0]?.id || "";
  })();

  // 当前选中的模型被删除 → 回退到「跟随激活 provider」，避免发送失效的 llm_route/llm_model
  useEffect(() => {
    if (error || providers.length === 0 || !value) return;
    const exists = modelOptions.some((o) => o.modelId === value);
    if (!exists) onChange({ provider: "", modelId: "" });
    // modelOptions 依赖 providers 派生，这里显式按 providers 判空避免每渲染触发
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providers, value, error, onChange]);

  // value 为空 = 跟随激活 provider（不发送 llm_route/llm_model），视觉上显示激活 provider 的默认模型
  const selectValue = (() => {
    if (value) {
      // 已选模型：按 provider + modelId 定位（若有 provider 则精确匹配，否则回退到首个 modelId 匹配）
      const opt = provider
        ? modelOptions.find((o) => o.provider === provider && o.modelId === value)
        : modelOptions.find((o) => o.modelId === value);
      if (opt) return optionValue(opt);
    }
    // 未选：用激活 provider 的默认模型
    const defOpt = modelOptions.find(
      (o) => o.provider === activeName && o.modelId === activeDefaultModelId
    );
    return defOpt ? optionValue(defOpt) : "";
  })();

  // 当前选中项的显示名称
  const currentLabel = (() => {
    const opt = parseOptionValue(selectValue);
    if (!opt) return "选择模型";
    const p = providers.find((pp) => pp.name === opt.provider);
    const m = (p?.models || []).find((mm) => mm.id === opt.modelId);
    return m?.name || m?.id || opt.modelId;
  })();

  return (
    <Select
      value={selectValue}
      onValueChange={(v) => {
        const opt = parseOptionValue(v);
        if (opt) onChange({ provider: opt.provider, modelId: opt.modelId });
      }}
    >
      <SelectTrigger
        title={error ? "配置服务不可用，使用默认模型" : undefined}
        className="h-8 max-w-[200px] gap-1 border-0 bg-transparent px-4 text-xs shadow-none outline-none transition-colors hover:bg-muted/60 focus:ring-0"
      >
        <SelectValue placeholder="选择模型">
          {currentLabel}
        </SelectValue>
      </SelectTrigger>
      <SelectContent className="max-h-64 min-w-[200px]">
        {providers.map((p) => {
          const models = (p.models || []).filter((m) => m.id);
          if (models.length === 0) return null;
          return (
            <SelectGroup key={p.name}>
              <SelectLabel className="!pl-2 text-xs">{p.display_name || p.name}</SelectLabel>
              {models.map((m) => (
                <SelectItem
                  key={optionValue({ provider: p.name, modelId: m.id })}
                  value={optionValue({ provider: p.name, modelId: m.id })}
                  className="text-xs"
                >
                  {m.name || m.id}
                </SelectItem>
              ))}
            </SelectGroup>
          );
        })}
      </SelectContent>
    </Select>
  );
}