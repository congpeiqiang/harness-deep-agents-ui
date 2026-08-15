export interface StandaloneConfig {
  deploymentUrl: string;
  assistantId: string;
  langsmithApiKey?: string;
  queryKeywords?: string[]; // 数据查询触发关键词（前后端共用，注入 LLM prompt 用）
  enableThinking?: boolean; // 是否开启模型思考：开→后端真思考且前端显示；关→后端不思考且不显示（前后端共用）
}
// TODO  MC8yOmFIVnBZMlhrdUp2bG43bmx2TG82YjFwVU9BPT06YjNiYTlmNzE=

const CONFIG_KEY = "deep-agent-config";

// 默认查询关键词（与后端 MAIN_AGENT_PROMPT.md 保持一致）
export const DEFAULT_QUERY_KEYWORDS = [
  "查询", "统计", "分析", "多少", "列表", "汇总", "排名", "占比", "趋势",
];

// 获取配置中的查询关键词，缺省回退到默认值
export function getQueryKeywords(): string[] {
  if (typeof window === "undefined") return DEFAULT_QUERY_KEYWORDS;
  try {
    const config = getConfig();
    const kws = config?.queryKeywords;
    if (Array.isArray(kws) && kws.length > 0) {
      return kws;
    }
  } catch {
    // ignore
  }
  return DEFAULT_QUERY_KEYWORDS;
}

// 是否开启模型思考，缺省默认开启（当前两个模型默认思考开，与后端一致）
export function getEnableThinking(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return getConfig()?.enableThinking ?? true;
  } catch {
    return true;
  }
}

export function getConfig(): StandaloneConfig | null {
  if (typeof window === "undefined") return null;

  const stored = localStorage.getItem(CONFIG_KEY);
  if (!stored) return null;

  try {
    return JSON.parse(stored);
  } catch {
    return null;
  }
}
// NOTE  MS8yOmFIVnBZMlhrdUp2bG43bmx2TG82YjFwVU9BPT06YjNiYTlmNzE=

export function saveConfig(config: StandaloneConfig): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
}
