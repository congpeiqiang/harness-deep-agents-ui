export interface StandaloneConfig {
  deploymentUrl: string;
  assistantId: string;
  langsmithApiKey?: string;
}
// TODO  MC8yOmFIVnBZMlhrdUp2bG43bmx2TG82YjFwVU9BPT06YjNiYTlmNzE=

const CONFIG_KEY = "deep-agent-config";

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
