import type { InsightItem, Track } from '../types.js';
import { TRACKS } from '../types.js';
import { RESEARCH_DIRECTIONS } from '../config.js';
import { chat, llmAvailable, parseJsonResponse } from './llm.js';

const BATCH_SIZE = 10;
const NO_BASIS = '首次追踪，暂无前序对比';

const DIRECTION_IDS = new Set(RESEARCH_DIRECTIONS.map((d) => d.id));

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
    directions: RESEARCH_DIRECTIONS.filter((d) => d.pattern.test(text))
      .slice(0, 2)
      .map((d) => d.id),
    keywords: [],
    relevance: 3, // 启发式无法判断价值，默认放行进报告
    improvement: item.source === 'arxiv' ? NO_BASIS : undefined,
  };
}

const DIRECTION_VOCAB = RESEARCH_DIRECTIONS.map((d) => `${d.id}（${d.hint}）`).join('；');

const SYSTEM_PROMPT = `你是 AI 行业战略分析师。对每条输入的 AI 行业信息，输出严格的 JSON 数组（不要任何其他文字、不要代码围栏），每个元素结构为：
{"id": "<原样返回的 id>", "track": "<一级赛道>", "directions": ["<二级研究方向 id，0-2 个>"], "keywords": ["<技术关键词，最多 5 个>"], "relevance": <1-5 整数>, "title_zh": "<结论式中文标题，≤28字>", "improvement": "<一句话改进点提炼>", "takeaway": "<人话版一句结论，≤40字>"}

【track】必须从以下枚举单选：${TRACKS.join(' | ')}
- foundation-model=基础模型架构与预训练; multimodal=多模态; agent=Agent与工具调用; reasoning=推理能力; alignment=对齐与安全; application=应用/产品/API; infra=训练推理基础设施; other=无法归类

【directions】只能从以下词表选 id（0-2 个，没有匹配就给空数组，禁止发明新 id）：
${DIRECTION_VOCAB}

【relevance】战略参考价值评分（用于过滤信息噪音，严格执行）：
- 5 = 头部厂商重大发布或方向性技术突破（新模型/新范式）
- 4 = 显著技术进展、重要开源发布、高信号研究
- 3 = 有参考价值的常规技术进展
- 2 = 边缘相关（工程细节、区域性/垂直应用）
- 1 = 无战略价值：客户案例宣传、公关文、人事任命、市场营销、活动通稿

【title_zh】**结论式标题**，≤28 字：写成有信息增量的 claim，让读者只看标题就知道"发生了什么、有多大"。
- 必须含关键数字或结论性判断（提速多少、超越谁、首个什么）
- 禁止纯名词式论文题翻译（错误示例："KV-PRM：高效过程奖励模型"；正确示例："KV cache 复用让过程奖励模型提速 5000 倍"）
- 保留关键专有名词（模型名/产品名），不标题党、不夸大原文没有的结论。

【takeaway】人话版一句结论，≤40 字：非本领域读者也能懂，最多保留 1 个术语，说清"这事让什么变得可能/更好"。与 improvement 的区别：improvement 面向专业读者讲对比，takeaway 面向扫读者讲意义。

【improvement】规则（严格遵守，禁止编造）：
- 仅依据给定的标题与摘要文本，提炼"相较前序工作/上一版本的改进点"，一句话中文。
- 文本中没有可依据的对比信息时，必须原样输出："${NO_BASIS}"
- github/blog 类信息概括"这次发布做了什么"，禁止推测未提及的内容。

few-shot 示例：
输入: {"id":"a1","source":"arxiv","title":"FooLM: Scaling Mixture-of-Experts to 1T","content":"...outperforms dense baselines by 12% on MMLU with 40% less compute..."}
输出元素: {"id":"a1","track":"foundation-model","directions":["model-arch"],"keywords":["MoE","scaling"],"relevance":4,"title_zh":"FooLM 用 4 成算力超稠密基线 12%，MoE 撑到万亿参数","improvement":"以 MoE 架构在 MMLU 上超越稠密基线 12%，同时降低 40% 计算量","takeaway":"训练大模型的算力成本有了直降四成的新路子"}
输入: {"id":"b2","source":"blog","title":"Acme Corp transforms customer service with GPT","content":"Case study about how Acme uses our API..."}
输出元素: {"id":"b2","track":"application","directions":[],"keywords":["case study"],"relevance":1,"title_zh":"Acme 客服客户案例","improvement":"发布 Acme 公司使用 API 改造客服的客户案例","takeaway":"一篇客户案例宣传稿"}`;

interface ClassifyResult {
  id: string;
  track: string;
  directions: string[];
  keywords: string[];
  relevance: number;
  title_zh: string;
  improvement: string;
  takeaway: string;
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
      directions: (r.directions ?? []).filter((d) => DIRECTION_IDS.has(String(d))).slice(0, 2),
      keywords: (r.keywords ?? []).slice(0, 5).map(String),
      relevance: Math.min(5, Math.max(1, Math.round(Number(r.relevance) || 3))),
      title_zh: r.title_zh ? String(r.title_zh).slice(0, 56) : undefined,
      improvement: String(r.improvement ?? NO_BASIS),
      takeaway: r.takeaway ? String(r.takeaway).slice(0, 80) : undefined,
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
