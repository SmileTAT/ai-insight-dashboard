import { fetchWithRetry } from '../util/http.js';

/**
 * LLM Provider 抽象层（PRD 七）：任何 OpenAI-compatible 端点均可。
 * 环境变量：
 *   LLM_API_KEY      - 必填才启用 LLM；缺省时全流程降级为启发式规则
 *   LLM_BASE_URL     - 默认 DeepSeek
 *   LLM_MODEL        - 周报/批量归类用的低成本模型
 *   LLM_STRONG_MODEL - 月报综述用的强模型（缺省回落到 LLM_MODEL）
 */
// 注意用 || 而非 ??：CI 中 `${{ vars.X }}` 未配置时注入的是空字符串而非 undefined
const BASE_URL = (process.env.LLM_BASE_URL || 'https://api.deepseek.com/v1').replace(/\/$/, '');
const MODEL = process.env.LLM_MODEL || 'deepseek-chat';
const STRONG_MODEL = process.env.LLM_STRONG_MODEL || MODEL;

const usage = { requests: 0, total_tokens: 0 };

export function llmAvailable(): boolean {
  return Boolean(process.env.LLM_API_KEY);
}

export function llmUsage(): { requests: number; total_tokens: number } {
  return { ...usage };
}

export async function chat(
  system: string,
  user: string,
  opts: { strong?: boolean } = {},
): Promise<string> {
  const apiKey = process.env.LLM_API_KEY;
  if (!apiKey) throw new Error('LLM_API_KEY 未配置');

  const res = await fetchWithRetry(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: opts.strong ? STRONG_MODEL : MODEL,
      temperature: 0.2,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  });
  if (!res.ok) {
    throw new Error(`LLM API HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const data = (await res.json()) as {
    choices: Array<{ message: { content: string } }>;
    usage?: { total_tokens?: number };
  };
  usage.requests += 1;
  usage.total_tokens += data.usage?.total_tokens ?? 0;
  return data.choices[0]?.message?.content ?? '';
}

/** 剥离 markdown 代码围栏后解析 JSON */
export function parseJsonResponse<T>(text: string): T {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  // 容错：截取首个 JSON 起始符到最后一个结束符
  const start = cleaned.search(/[[{]/);
  const end = Math.max(cleaned.lastIndexOf(']'), cleaned.lastIndexOf('}'));
  if (start === -1 || end === -1) throw new Error(`LLM 输出不是 JSON: ${text.slice(0, 120)}`);
  return JSON.parse(cleaned.slice(start, end + 1)) as T;
}
