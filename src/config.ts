import { readFileSync } from 'node:fs';
import type { BlogSourceConfig, OrgConfig, Track } from './types.js';

/** 采集窗口（天） */
export const WINDOW_DAYS = Number(process.env.WINDOW_DAYS ?? 7);

/** API 端点可通过环境变量覆盖（镜像站/测试用） */
export const ARXIV_API_BASE =
  process.env.ARXIV_API_BASE ?? 'https://export.arxiv.org/api/query';
export const GITHUB_API_BASE = process.env.GITHUB_API_BASE ?? 'https://api.github.com';

export const ARXIV_CATEGORIES = ['cs.AI', 'cs.LG', 'cs.CL'];

/** 每周进入 LLM 完整分析的 arXiv 论文上限（PRD 5.2 二级漏斗限额 N） */
export const ARXIV_LLM_LIMIT = Number(process.env.ARXIV_LLM_LIMIT ?? 50);

/** 规则粗筛后保留的候选池上限（其余不入档） */
export const ARXIV_CANDIDATE_LIMIT = Number(process.env.ARXIV_CANDIDATE_LIMIT ?? 200);

/** arXiv API 分页上限（每页 200 条） */
export const ARXIV_MAX_PAGES = Number(process.env.ARXIV_MAX_PAGES ?? 10);

/** PRD 4.1 监控目标组织清单 */
export const GITHUB_ORGS: OrgConfig[] = [
  { org: 'openai', company: 'openai' },
  { org: 'google-deepmind', company: 'google' },
  { org: 'google-gemini', company: 'google' },
  { org: 'anthropics', company: 'anthropic' },
  { org: 'meta-llama', company: 'meta' },
  { org: 'facebookresearch', company: 'meta' },
  { org: 'microsoft', company: 'microsoft', keywordFilter: true },
];

/** PRD 4.1 官方博客源；可用 BLOG_SOURCES_FILE 指向 JSON 文件整体覆盖（include 为正则字符串） */
const DEFAULT_BLOG_SOURCES: BlogSourceConfig[] = [
  {
    id: 'openai-news',
    company: 'openai',
    type: 'sitemap',
    url: 'https://openai.com/sitemap.xml',
    include: /openai\.com\/(news|index)\/[^/]+\/?$/,
  },
  {
    id: 'deepmind-blog',
    company: 'google',
    type: 'rss',
    url: 'https://deepmind.google/blog/feed/basic/',
    include: /./,
  },
  {
    id: 'anthropic-news',
    company: 'anthropic',
    type: 'sitemap',
    url: 'https://www.anthropic.com/sitemap.xml',
    include: /anthropic\.com\/news\/[^/]+\/?$/,
  },
];

function loadBlogSources(): BlogSourceConfig[] {
  const file = process.env.BLOG_SOURCES_FILE;
  if (!file) return DEFAULT_BLOG_SOURCES;
  const raw = JSON.parse(readFileSync(file, 'utf8')) as Array<
    Omit<BlogSourceConfig, 'include'> & { include: string }
  >;
  return raw.map((s) => ({ ...s, include: new RegExp(s.include) }));
}

export const BLOG_SOURCES: BlogSourceConfig[] = loadBlogSources();

/** arXiv 规则粗筛关键词库（PRD 5.2 一级漏斗，可持续扩充） */
export const ARXIV_PREFILTER_KEYWORDS: Array<{ term: string; weight: number }> = [
  { term: 'state-of-the-art', weight: 2 },
  { term: 'sota', weight: 2 },
  { term: 'survey', weight: 3 },
  { term: 'benchmark', weight: 2 },
  { term: 'scaling law', weight: 3 },
  { term: 'mixture-of-experts', weight: 3 },
  { term: 'mixture of experts', weight: 3 },
  { term: 'world model', weight: 3 },
  { term: 'foundation model', weight: 3 },
  { term: 'large language model', weight: 2 },
  { term: 'multimodal', weight: 2 },
  { term: 'vision-language', weight: 2 },
  { term: 'video generation', weight: 2 },
  { term: 'agent', weight: 2 },
  { term: 'tool use', weight: 2 },
  { term: 'reasoning', weight: 2 },
  { term: 'chain-of-thought', weight: 2 },
  { term: 'reinforcement learning', weight: 1 },
  { term: 'rlhf', weight: 2 },
  { term: 'alignment', weight: 2 },
  { term: 'safety', weight: 1 },
  { term: 'red team', weight: 2 },
  { term: 'jailbreak', weight: 1 },
  { term: 'long context', weight: 2 },
  { term: 'retrieval-augmented', weight: 2 },
  { term: 'quantization', weight: 1 },
  { term: 'distillation', weight: 1 },
  { term: 'inference optimization', weight: 2 },
  { term: 'pretraining', weight: 1 },
  { term: 'post-training', weight: 2 },
  { term: 'diffusion', weight: 1 },
  { term: 'open-source model', weight: 2 },
  { term: 'evaluation', weight: 1 },
];

/** microsoft 等大组织的 AI 相关性过滤 */
export const ORG_AI_FILTER =
  /\b(ai|llm|gpt|agent|copilot|phi|prompt|rag|genai|onnx|deepspeed|autogen|semantic[- ]kernel|machine[- ]?learning|deep[- ]?learning|language model|foundation model|inference|transformer)\b/i;

export const TRACK_LABELS: Record<Track, string> = {
  'foundation-model': '基础模型',
  multimodal: '多模态',
  agent: 'Agent',
  reasoning: '推理',
  alignment: '对齐/安全',
  application: '应用/产品',
  infra: '训练与推理基础设施',
  other: '其他',
};

export const COMPANY_LABELS: Record<string, string> = {
  openai: 'OpenAI',
  google: 'Google',
  anthropic: 'Anthropic',
  meta: 'Meta',
  microsoft: 'Microsoft',
  other: '其他',
};

/** 报告中公司的固定展示顺序 */
export const COMPANY_ORDER = ['openai', 'google', 'anthropic', 'meta', 'microsoft'] as const;
