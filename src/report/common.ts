import { COMPANY_LABELS, COMPANY_ORDER, TRACK_LABELS } from '../config.js';
import type { Company, InsightItem, Track } from '../types.js';

export function trackLabel(track: Track | undefined): string {
  return TRACK_LABELS[track ?? 'other'];
}

export function companyLabel(company: Company): string {
  return COMPANY_LABELS[company] ?? company;
}

export function groupByTrack(items: InsightItem[]): Map<Track, InsightItem[]> {
  const map = new Map<Track, InsightItem[]>();
  for (const item of items) {
    const track = item.ai_tags?.track ?? 'other';
    if (!map.has(track)) map.set(track, []);
    map.get(track)!.push(item);
  }
  return map;
}

export function groupByCompany(items: InsightItem[]): Map<Company, InsightItem[]> {
  const map = new Map<Company, InsightItem[]>();
  for (const item of items) {
    if (!map.has(item.company)) map.set(item.company, []);
    map.get(item.company)!.push(item);
  }
  return map;
}

/** 公司固定顺序 + other 兜底 */
export function orderedCompanies(present: Iterable<Company>): Company[] {
  const set = new Set(present);
  const ordered = COMPANY_ORDER.filter((c) => set.has(c)) as Company[];
  if (set.has('other')) ordered.push('other');
  return ordered;
}

export function mdLink(item: InsightItem): string {
  const title = item.title.replace(/[[\]|]/g, ' ').trim();
  return `[${title}](${item.url})`;
}

/** 用于喂给 LLM 的紧凑条目表示 */
export function compactForLlm(items: InsightItem[], limit: number): string {
  return JSON.stringify(
    items.slice(0, limit).map((i) => ({
      source: i.source,
      company: i.company,
      date: i.publish_date,
      track: i.ai_tags?.track ?? 'other',
      title: i.title,
      improvement: i.ai_tags?.improvement,
    })),
    null,
    1,
  );
}
