import { readFileSync } from 'node:fs';
import type { BlogSourceConfig, OrgConfig, Track } from './types.js';

/** 采集窗口（天）。数值型环境变量统一用 || 兜底，空字符串视为未设置 */
export const WINDOW_DAYS = Number(process.env.WINDOW_DAYS || 7);

/** API 端点可通过环境变量覆盖（镜像站/测试用） */
export const ARXIV_API_BASE =
  process.env.ARXIV_API_BASE || 'https://export.arxiv.org/api/query';
export const GITHUB_API_BASE = process.env.GITHUB_API_BASE || 'https://api.github.com';

export const ARXIV_CATEGORIES = ['cs.AI', 'cs.LG', 'cs.CL'];

/** 每周进入 LLM 完整分析的 arXiv 论文上限（PRD 5.2 二级漏斗限额 N） */
export const ARXIV_LLM_LIMIT = Number(process.env.ARXIV_LLM_LIMIT || 50);

/** 规则粗筛后保留的候选池上限（其余不入档） */
export const ARXIV_CANDIDATE_LIMIT = Number(process.env.ARXIV_CANDIDATE_LIMIT || 200);

/** arXiv API 分页上限（每页 200 条） */
export const ARXIV_MAX_PAGES = Number(process.env.ARXIV_MAX_PAGES || 10);

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

/** 二级研究方向受控词表：pattern 用于 LLM 不可用时的启发式回退 */
export interface DirectionDef {
  id: string;
  label: string;
  /** 给 LLM 的判定提示 */
  hint: string;
  pattern: RegExp;
}

export const RESEARCH_DIRECTIONS: DirectionDef[] = [
  { id: 'gui-agent', label: 'GUI Agent 与计算机使用', hint: 'GUI/浏览器/操作系统自动化 agent、computer use', pattern: /gui.?agent|computer.?use|browser.?(agent|automation)|web.?agent|screen(shot)? understanding|os.?agent/i },
  { id: 'code-agent', label: '编码 Agent', hint: '代码生成、SWE agent、软件工程自动化', pattern: /cod(e|ing).?(agent|gen)|swe-?bench|software engineer|program (synthesis|repair)/i },
  { id: 'agent-reliability', label: 'Agent 评测与可靠性', hint: 'agent 基准、失败分析、鲁棒性', pattern: /agent\w*.{0,40}(bench|eval|fail|robust|reliab)|(bench|eval)\w*.{0,40}agent/i },
  { id: 'multi-agent', label: '多智能体协作', hint: '多 agent 系统、协作、群体智能', pattern: /multi-?agent|agent (collaborat|swarm|societ)/i },
  { id: 'memory', label: '记忆与个性化', hint: '长期记忆系统、个性化、用户建模', pattern: /memor(y|ies)|personaliz|user (profil|model)/i },
  { id: 'on-device', label: '端侧与小模型', hint: '端侧部署、边缘推理、小模型', pattern: /on-?device|edge (deploy|inference|ai)|small (language )?model|\bslm\b|mobile (llm|inference)/i },
  { id: 'rl-post-training', label: '强化学习与后训练', hint: 'RLHF/GRPO/DPO、奖励模型、后训练', pattern: /rlhf|grpo|dpo\b|reinforcement learning|post-?training|reward (model|hack)/i },
  { id: 'test-time', label: '推理时扩展', hint: 'test-time compute/scaling、思维链、深度推理', pattern: /test-?time|inference.?time (scal|comput)|chain-?of-?thought|o1-?(like|style)|thinking (model|mode)/i },
  { id: 'long-context', label: '长上下文', hint: '上下文窗口扩展、长文本处理', pattern: /long.?context|context (window|length|extension)/i },
  { id: 'world-model', label: '世界模型与具身智能', hint: '世界模型、机器人、VLA、具身智能', pattern: /world.?model|embodied|robot|\bvla\b|vision-?language-?action/i },
  { id: 'video-gen', label: '视频与图像生成', hint: '文生视频/图、扩散模型生成', pattern: /(video|image) (gen|synthesis)|text-?to-?(video|image)|diffusion (model|transformer)/i },
  { id: 'model-arch', label: '模型架构与 MoE', hint: '架构创新、MoE、注意力替代、SSM', pattern: /mixture.?of.?experts|\bmoe\b|state.?space model|\bssm\b|mamba|attention (mechanism|variant)|architecture/i },
  { id: 'safety-alignment', label: '安全与对齐', hint: '对齐、越狱、红队、可解释性', pattern: /safet|align|jailbreak|red.?team|interpretab|guardrail/i },
  { id: 'rag-retrieval', label: '检索与知识', hint: 'RAG、检索增强、知识库', pattern: /retriev|\brag\b|knowledge (base|graph)/i },
  { id: 'infra-efficiency', label: '训练与推理效率', hint: '推理优化、量化、蒸馏、训练效率', pattern: /inference (optim|serv)|quantiz|distill|kv.?cache|throughput|training efficien/i },
];

/** 用户关注方向：命中时在周报中置顶并标记（逗号分隔的 direction id） */
export const FOCUS_DIRECTIONS = (process.env.FOCUS_DIRECTIONS || 'gui-agent,on-device,memory')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

/** 进入报告的最低战略相关性（1-5）；低于此值仅归档 */
export const MIN_REPORT_RELEVANCE = Number(process.env.MIN_REPORT_RELEVANCE || 3);

/** arXiv 规则粗筛关键词库（PRD 5.2 一级漏斗，可持续扩充） */
export const ARXIV_PREFILTER_KEYWORDS: Array<{ term: string; weight: number }> = [
  { term: 'state-of-the-art', weight: 2 },
  { term: 'sota', weight: 2 },
  // 评测/综述类降权：避免报告被 benchmark 论文淹没（2026-07 第一期的教训）
  { term: 'survey', weight: 1 },
  { term: 'benchmark', weight: 1 },
  { term: 'scaling law', weight: 3 },
  // 研究方向词表对齐的方法创新类关键词
  { term: 'gui agent', weight: 3 },
  { term: 'computer use', weight: 3 },
  { term: 'web agent', weight: 3 },
  { term: 'on-device', weight: 3 },
  { term: 'edge deployment', weight: 2 },
  { term: 'small language model', weight: 2 },
  { term: 'memory', weight: 2 },
  { term: 'personalization', weight: 2 },
  { term: 'test-time', weight: 2 },
  { term: 'self-improv', weight: 2 },
  { term: 'multi-agent', weight: 2 },
  { term: 'state space model', weight: 2 },
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
