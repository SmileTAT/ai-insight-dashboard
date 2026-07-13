import { GITHUB_API_BASE, GITHUB_ORGS, ORG_AI_FILTER } from '../config.js';
import type { InsightItem, OrgConfig } from '../types.js';
import { fetchJson } from '../util/http.js';
import { ymd } from '../util/dates.js';

const API = GITHUB_API_BASE;

function headers(): Record<string, string> {
  const h: Record<string, string> = {
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
  };
  const token = process.env.GITHUB_TOKEN;
  if (token) h.authorization = `Bearer ${token}`;
  return h;
}

interface Repo {
  full_name: string;
  html_url: string;
  description: string | null;
  created_at: string;
  fork: boolean;
}

interface OrgEvent {
  type: string;
  created_at: string;
  repo: { name: string };
  payload: {
    action?: string;
    release?: {
      tag_name: string;
      name: string | null;
      body: string | null;
      html_url: string;
      published_at: string;
    };
  };
}

function aiRelevant(cfg: OrgConfig, text: string): boolean {
  return !cfg.keywordFilter || ORG_AI_FILTER.test(text);
}

async function collectOrgNewRepos(cfg: OrgConfig, windowStart: Date): Promise<InsightItem[]> {
  const repos = await fetchJson<Repo[]>(
    `${API}/orgs/${cfg.org}/repos?sort=created&direction=desc&per_page=100`,
    { headers: headers() },
  );
  return repos
    .filter((r) => !r.fork && new Date(r.created_at) >= windowStart)
    .filter((r) => aiRelevant(cfg, `${r.full_name} ${r.description ?? ''}`))
    .map((r) => ({
      id: `github:repo:${r.full_name}`,
      source: 'github' as const,
      company: cfg.company,
      publish_date: ymd(new Date(r.created_at)),
      title: `新仓库：${r.full_name}`,
      url: r.html_url,
      raw_content: (r.description ?? '').slice(0, 600),
    }));
}

async function collectOrgReleases(cfg: OrgConfig, windowStart: Date): Promise<InsightItem[]> {
  // 组织公开事件流中筛选 ReleaseEvent（覆盖近 90 天/300 条，对周窗口足够）
  const events = await fetchJson<OrgEvent[]>(`${API}/orgs/${cfg.org}/events?per_page=100`, {
    headers: headers(),
  });
  const items: InsightItem[] = [];
  for (const e of events) {
    if (e.type !== 'ReleaseEvent' || e.payload.action !== 'published') continue;
    const rel = e.payload.release;
    if (!rel || new Date(e.created_at) < windowStart) continue;
    if (!aiRelevant(cfg, `${e.repo.name} ${rel.name ?? ''} ${rel.body ?? ''}`)) continue;
    items.push({
      id: `github:release:${e.repo.name}:${rel.tag_name}`,
      source: 'github',
      company: cfg.company,
      publish_date: ymd(new Date(rel.published_at ?? e.created_at)),
      title: `Release：${e.repo.name} ${rel.name || rel.tag_name}`,
      url: rel.html_url,
      raw_content: (rel.body ?? '').replace(/\r/g, '').slice(0, 600),
    });
  }
  return items;
}

export async function collectGithub(
  windowStart: Date,
  seenIds: Set<string>,
): Promise<InsightItem[]> {
  const all: InsightItem[] = [];
  for (const cfg of GITHUB_ORGS) {
    const results = await Promise.allSettled([
      collectOrgNewRepos(cfg, windowStart),
      collectOrgReleases(cfg, windowStart),
    ]);
    for (const r of results) {
      if (r.status === 'fulfilled') all.push(...r.value);
      else console.warn(`[github] ${cfg.org} 部分采集失败:`, String(r.reason));
    }
  }
  const fresh = all.filter((i) => !seenIds.has(i.id));
  console.log(`[github] collected=${all.length} fresh=${fresh.length}`);
  return fresh;
}
