import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { InsightItem } from './types.js';
import { isoWeek } from './util/dates.js';

const DATA_DIR = 'data';

/** PRD P0：原始数据按 data/YYYY/week-WW/ 归档，作为月报聚合的数据基础 */
export function archiveWeek(items: InsightItem[], runDate: Date): string {
  const { year, week } = isoWeek(runDate);
  const dir = join(DATA_DIR, String(year), `week-${String(week).padStart(2, '0')}`);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'items.json');

  // 同周多次运行（手动补跑）时按 id 合并，不覆盖已有数据
  const existing: InsightItem[] = existsSync(file)
    ? (JSON.parse(readFileSync(file, 'utf8')) as InsightItem[])
    : [];
  const merged = new Map(existing.map((i) => [i.id, i]));
  for (const item of items) merged.set(item.id, item);

  writeFileSync(file, JSON.stringify([...merged.values()], null, 2) + '\n');
  return file;
}

/** 已归档的全部条目 id（跨周去重用） */
export function archivedIds(): Set<string> {
  return new Set(loadAllItems().map((i) => i.id));
}

export function loadAllItems(): InsightItem[] {
  if (!existsSync(DATA_DIR)) return [];
  const items: InsightItem[] = [];
  for (const year of readdirSync(DATA_DIR)) {
    const yearDir = join(DATA_DIR, year);
    let weeks: string[];
    try {
      weeks = readdirSync(yearDir);
    } catch {
      continue;
    }
    for (const week of weeks) {
      const file = join(yearDir, week, 'items.json');
      if (!existsSync(file)) continue;
      try {
        items.push(...(JSON.parse(readFileSync(file, 'utf8')) as InsightItem[]));
      } catch (err) {
        console.warn(`[archive] 读取失败 ${file}:`, String(err));
      }
    }
  }
  return items;
}

/** 月报聚合入口：按 publish_date 取指定月（YYYY-MM）的全部归档条目 */
export function loadItemsForMonth(month: string): InsightItem[] {
  const byId = new Map<string, InsightItem>();
  for (const item of loadAllItems()) {
    if (item.publish_date.startsWith(month)) byId.set(item.id, item);
  }
  return [...byId.values()];
}
