import type { InsightItem, Track } from '../types.js';
import { TRACKS } from '../types.js';
import { chat, llmAvailable, parseJsonResponse } from './llm.js';

const BATCH_SIZE = 10;
const NO_BASIS = '首次追踪，暂无前序对比';

/** LLM 不可用时的启发式赛道归类（保证流水线永远可运行） */
const HEURISTIC_RULES: Array<{ pattern: RegExp; track: Track }> = [
  { pattern: /multimodal|vision.?language|video|image|speech|audio|text-to-/i, track: 'multimodal' },
  { pattern: /\bagent|tool.?use|function.?call|mcp\b|computer.?use/i, track: 'agent' },
  { pattern: /reason|chain.?of.?thought|\bcot\b|math|planning|o1|thinking/i, track: 'reasoning' },
  { pattern: /align|safety|rlhf|red.?team|jailbreak|harmless|constitut/i, track: 'alignment' },
  { pattern: /quantiz|distill|inference|serving|kernel|gpu|training.?efficien|deepspeed|onnx/i, track: 'infra' },
  { pattern: /pretrain|foundation model|large language model|\bllm\b|scaling law|mixture.?of.?experts|\bmoe\b|architecture/i, track: 'foundation-model' },
  { pattern: /app|product|copilot|assistant|api\b|sdk|plugin|enterprise/i, track: 'application' },
];

function heuristicClassify(item: InsightItem): void {
  const text = `${item.title} ${item.raw_content}`;
  const rule = HEURISTIC_RULES.find((r) => r.pattern.test(text));
  item.ai_tags = {
    track: rule?.track ?? 'other',
    keywords: [],
    improvement: item.source === 'arxiv' ? NO_BASIS : undefined,
  };
}

const SYSTEM_PROMPT = `你是 AI 行业战略分析师。对每条输入的 AI 行业信息，输出严格的 JSON 数组（不要任何其他文字、不要代码围栏），每个元素结构为：
{"id": "<原样返回的 id>", "track": "<赛道>", "keywords": ["<技术关键词，最多 5 个>"], "improvement": "<一句话改进点提炼>"}

赛道 track 必须从以下枚举中单选：${TRACKS.join(' | ')}
- foundation-model=基础模型架构与预训练; multimodal=多模态; agent=Agent与工具调用; reasoning=推理能力; alignment=对齐与安全; application=应用/产品/API; infra=训练推理基础设施; other=无法归类

improvement 字段规则（严格遵守，禁止编造）：
- 仅依据给定的标题与摘要文本，提炼"相较前序工作/上一版本的改进点"，一句话，中文。
- 如果文本中没有可依据的对比信息（没有提到 baseline、上一版本、相较改进），必须原样输出："${NO_BASIS}"
- 对 github/blog 类信息，improvement 概括"这次发布做了什么"，同样禁止推测未提及的内容。

few-shot 示例：
输入: {"id":"a1","source":"arxiv","title":"FooLM: Scaling Mixture-of-Experts to 1T","content":"...outperforms dense baselines by 12% on MMLU with 40% less compute..."}
输出元素: {"id":"a1","track":"foundation-model","keywords":["MoE","scaling"],"improvement":"以 MoE 架构在 MMLU 上超越稠密基线 12%，同时降低 40% 计算量"}
输入: {"id":"b2","source":"arxiv","title":"A Benchmark for X","content":"We introduce a new benchmark..."(无对比信息)}
输出元素: {"id":"b2","track":"reasoning","keywords":["benchmark"],"improvement":"${NO_BASIS}"}`;

interface ClassifyResult {
  id: string;
  track: string;
  keywords: string[];
  improvement: string;
}

async function classifyBatch(batch: InsightItem[]): Promise<void> {
  const payload = batch.map((i) => ({
    id: i.id,
    source: i.source,
    company: i.company,
    title: i.title,
    content: i.raw_content.slice(0, 1200),
  }));
  const raw = await chat(SYSTEM_PROMPT, JSON.stringify(payload, null, 1));
  const results = parseJsonResponse<ClassifyResult[]>(raw);
  const byId = new Map(results.map((r) => [r.id, r]));
  for (const item of batch) {
    const r = byId.get(item.id);
    if (!r) {
      heuristicClassify(item);
      continue;
    }
    item.ai_tags = {
      track: (TRACKS as readonly string[]).includes(r.track) ? (r.track as Track) : 'other',
      keywords: (r.keywords ?? []).slice(0, 5).map(String),
      improvement: String(r.improvement ?? NO_BASIS),
    };
  }
}

/** 对 items 就地写入 ai_tags；LLM 失败的批次降级为启发式，不中断流水线 */
export async function classifyItems(items: InsightItem[]): Promise<void> {
  if (!llmAvailable()) {
    console.warn('[classify] LLM_API_KEY 未配置，使用启发式降级归类');
    items.forEach(heuristicClassify);
    return;
  }
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE);
    try {
      await classifyBatch(batch);
    } catch (err) {
      console.warn(`[classify] 批次 ${i / BATCH_SIZE + 1} LLM 失败，降级启发式:`, String(err));
      batch.forEach(heuristicClassify);
    }
  }
}
