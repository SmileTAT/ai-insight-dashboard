import { XMLParser } from 'fast-xml-parser';
import { BLOG_SOURCES } from '../config.js';
import type { BlogSourceConfig, InsightItem, State } from '../types.js';
import { fetchText, sleep } from '../util/http.js';
import { ymd } from '../util/dates.js';

const MAX_NEW_PER_SOURCE = 15;
const MAX_CHILD_SITEMAPS = 5;

interface SitemapUrl {
  loc: string;
  lastmod?: string;
}

function toArray<T>(v: T | T[] | undefined): T[] {
  if (v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}

const parser = new XMLParser({ ignoreAttributes: true });

/** 递归解析 sitemap（支持 sitemapindex），返回 {loc, lastmod} 列表 */
async function fetchSitemapUrls(url: string, depth = 0): Promise<SitemapUrl[]> {
  const xml = await fetchText(url);
  const doc = parser.parse(xml);

  if (doc?.urlset?.url) {
    return toArray<{ loc: string; lastmod?: string }>(doc.urlset.url).map((u) => ({
      loc: String(u.loc),
      lastmod: u.lastmod ? String(u.lastmod) : undefined,
    }));
  }
  if (doc?.sitemapindex?.sitemap && depth < 1) {
    const children = toArray<{ loc: string }>(doc.sitemapindex.sitemap)
      .map((s) => String(s.loc))
      // 优先抓可能包含文章的子 sitemap
      .sort((a, b) => Number(/news|blog|post/i.test(b)) - Number(/news|blog|post/i.test(a)))
      .slice(0, MAX_CHILD_SITEMAPS);
    const all: SitemapUrl[] = [];
    for (const child of children) {
      try {
        all.push(...(await fetchSitemapUrls(child, depth + 1)));
      } catch (err) {
        console.warn(`[blog] 子 sitemap 抓取失败 ${child}:`, String(err));
      }
    }
    return all;
  }
  return [];
}

/** 抓取文章页提取 <title> 与 meta description */
async function fetchPageMeta(url: string): Promise<{ title: string; description: string }> {
  try {
    const html = await fetchText(url);
    const title = html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim() ?? '';
    const description =
      html
        .match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i)?.[1]
        ?.trim() ??
      html
        .match(/<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i)?.[1]
        ?.trim() ??
      '';
    return { title, description };
  } catch {
    return { title: '', description: '' };
  }
}

function slugToTitle(url: string): string {
  const slug = url.replace(/\/+$/, '').split('/').pop() ?? url;
  return slug.replace(/[-_]/g, ' ');
}

async function collectSitemapSource(
  cfg: BlogSourceConfig,
  windowStart: Date,
  state: State,
): Promise<InsightItem[]> {
  const urls = (await fetchSitemapUrls(cfg.url)).filter((u) => cfg.include.test(u.loc));
  const seen = new Set(state.seen_blog_urls[cfg.id] ?? []);
  const firstRun = seen.size === 0;

  const fresh = urls.filter((u) => {
    if (seen.has(u.loc)) return false;
    if (u.lastmod) return new Date(u.lastmod) >= windowStart;
    // 无 lastmod：首次运行只建基线不上报，避免全量历史涌入
    return !firstRun;
  });

  const items: InsightItem[] = [];
  for (const u of fresh.slice(0, MAX_NEW_PER_SOURCE)) {
    const meta = await fetchPageMeta(u.loc);
    items.push({
      id: `blog:${u.loc}`,
      source: 'blog',
      company: cfg.company,
      publish_date: u.lastmod ? ymd(new Date(u.lastmod)) : ymd(new Date()),
      title: meta.title || slugToTitle(u.loc),
      url: u.loc,
      raw_content: meta.description.slice(0, 800),
    });
    await sleep(500);
  }

  // 更新差分基线：记录本次看到的全部文章 URL
  state.seen_blog_urls[cfg.id] = [...new Set([...seen, ...urls.map((u) => u.loc)])];
  return items;
}

async function collectRssSource(
  cfg: BlogSourceConfig,
  windowStart: Date,
  state: State,
): Promise<InsightItem[]> {
  const xml = await fetchText(cfg.url);
  const doc = parser.parse(xml);
  const rssItems = toArray<{
    title?: string;
    link?: string;
    pubDate?: string;
    description?: string;
  }>(doc?.rss?.channel?.item);

  const seen = new Set(state.seen_blog_urls[cfg.id] ?? []);
  const items: InsightItem[] = [];
  for (const it of rssItems) {
    const link = String(it.link ?? '').trim();
    if (!link || seen.has(link) || !cfg.include.test(link)) continue;
    const pub = it.pubDate ? new Date(it.pubDate) : undefined;
    if (pub && pub < windowStart) continue;
    items.push({
      id: `blog:${link}`,
      source: 'blog',
      company: cfg.company,
      publish_date: pub ? ymd(pub) : ymd(new Date()),
      title: String(it.title ?? '').trim() || slugToTitle(link),
      url: link,
      raw_content: String(it.description ?? '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 800),
    });
  }

  state.seen_blog_urls[cfg.id] = [
    ...new Set([...seen, ...rssItems.map((i) => String(i.link ?? '')).filter(Boolean)]),
  ];
  return items.slice(0, MAX_NEW_PER_SOURCE);
}

export async function collectBlogs(windowStart: Date, state: State): Promise<InsightItem[]> {
  const all: InsightItem[] = [];
  for (const cfg of BLOG_SOURCES) {
    try {
      const items =
        cfg.type === 'sitemap'
          ? await collectSitemapSource(cfg, windowStart, state)
          : await collectRssSource(cfg, windowStart, state);
      console.log(`[blog] ${cfg.id}: ${items.length} 条新文章`);
      all.push(...items);
    } catch (err) {
      console.warn(`[blog] ${cfg.id} 采集失败:`, String(err));
    }
  }
  return all;
}
