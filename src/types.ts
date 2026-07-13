export type Source = 'arxiv' | 'github' | 'blog';

export type Company =
  | 'openai'
  | 'google'
  | 'anthropic'
  | 'meta'
  | 'microsoft'
  | 'other';

export const TRACKS = [
  'foundation-model',
  'multimodal',
  'agent',
  'reasoning',
  'alignment',
  'application',
  'infra',
  'other',
] as const;

export type Track = (typeof TRACKS)[number];

export interface AiTags {
  track: Track;
  keywords: string[];
  /** 相较前序工作的改进点；无依据时为"首次追踪，暂无前序对比" */
  improvement?: string;
}

export interface InsightItem {
  id: string;
  source: Source;
  company: Company;
  /** YYYY-MM-DD (UTC) */
  publish_date: string;
  title: string;
  url: string;
  raw_content: string;
  /** 规则粗筛得分，仅 arXiv 使用，用于 LLM 精筛排序 */
  signal_score?: number;
  ai_tags?: AiTags;
}

export interface OrgConfig {
  org: string;
  company: Company;
  /** 组织仓库量大时按 AI 关键词过滤（如 microsoft） */
  keywordFilter?: boolean;
}

export interface BlogSourceConfig {
  id: string;
  company: Company;
  type: 'sitemap' | 'rss';
  url: string;
  /** 只保留匹配该正则的文章 URL */
  include: RegExp;
}

export interface State {
  last_weekly_run?: string;
  /** 每个博客源已见过的文章 URL（sitemap 差分基线） */
  seen_blog_urls: Record<string, string[]>;
  /** 已上报过的 GitHub 条目 id */
  seen_github_ids: string[];
}
