import { XMLParser } from 'fast-xml-parser';
import {
  ARXIV_API_BASE,
  ARXIV_CATEGORIES,
  ARXIV_CANDIDATE_LIMIT,
  ARXIV_MAX_PAGES,
  ARXIV_PREFILTER_KEYWORDS,
} from '../config.js';
import type { InsightItem } from '../types.js';
import { fetchText, sleep } from '../util/http.js';
import { arxivStamp, ymd } from '../util/dates.js';

const API = ARXIV_API_BASE;
const PAGE_SIZE = 200;

interface AtomEntry {
  id: string;
  title: string;
  summary: string;
  published: string;
}

function toArray<T>(v: T | T[] | undefined): T[] {
  if (v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}

/** PRD 5.2 一级漏斗：关键词加权打分，标题命中双倍权重 */
function signalScore(title: string, summary: string): number {
  const t = title.toLowerCase();
  const s = summary.toLowerCase();
  let score = 0;
  for (const { term, weight } of ARXIV_PREFILTER_KEYWORDS) {
    if (t.includes(term)) score += weight * 2;
    else if (s.includes(term)) score += weight;
  }
  return score;
}

export async function collectArxiv(windowStart: Date, windowEnd: Date): Promise<InsightItem[]> {
  const cats = ARXIV_CATEGORIES.map((c) => `cat:${c}`).join(' OR ');
  const query = `(${cats}) AND submittedDate:[${arxivStamp(windowStart)} TO ${arxivStamp(windowEnd)}]`;
  const parser = new XMLParser({ ignoreAttributes: true });

  const byId = new Map<string, InsightItem>();
  let totalFetched = 0;

  for (let page = 0; page < ARXIV_MAX_PAGES; page++) {
    const url =
      `${API}?search_query=${encodeURIComponent(query)}` +
      `&start=${page * PAGE_SIZE}&max_results=${PAGE_SIZE}` +
      `&sortBy=submittedDate&sortOrder=descending`;
    const xml = await fetchText(url);
    const doc = parser.parse(xml);
    const entries = toArray<AtomEntry>(doc?.feed?.entry);
    if (entries.length === 0) break;
    totalFetched += entries.length;

    for (const e of entries) {
      // e.id 形如 http://arxiv.org/abs/2501.12345v2 → 去版本号作为去重键
      const idMatch = String(e.id).match(/abs\/(.+?)(v\d+)?$/);
      const paperId = idMatch ? idMatch[1] : String(e.id);
      const title = String(e.title).replace(/\s+/g, ' ').trim();
      const summary = String(e.summary).replace(/\s+/g, ' ').trim();
      const score = signalScore(title, summary);
      if (score <= 0) continue;
      byId.set(paperId, {
        id: `arxiv:${paperId}`,
        source: 'arxiv',
        company: 'other',
        publish_date: ymd(new Date(e.published)),
        title,
        url: `https://arxiv.org/abs/${paperId}`,
        raw_content: summary.slice(0, 1500),
        signal_score: score,
      });
    }

    if (entries.length < PAGE_SIZE) break;
    await sleep(3000); // arXiv API 礼貌间隔
  }

  const candidates = [...byId.values()]
    .sort((a, b) => (b.signal_score ?? 0) - (a.signal_score ?? 0))
    .slice(0, ARXIV_CANDIDATE_LIMIT);

  console.log(
    `[arxiv] fetched=${totalFetched} prefiltered=${byId.size} candidates=${candidates.length}`,
  );
  return candidates;
}
