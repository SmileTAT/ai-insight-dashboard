import type { InsightItem, Track } from '../types.js';
import { MIN_REPORT_RELEVANCE } from '../config.js';
import { chat, llmAvailable, parseJsonResponse } from '../analysis/llm.js';
import {
  companyLabel,
  compactForLlm,
  groupByCompany,
  groupByTrack,
  mdLink,
  orderedCompanies,
  trackLabel,
} from './common.js';

interface MonthlyNarrative {
  overview: string;
  verdict: string;
  outlook: string[];
  /** company -> 战略重心一句话判断 */
  focus: Record<string, string>;
}

async function narrative(month: string, items: InsightItem[]): Promise<MonthlyNarrative> {
  const fallback: MonthlyNarrative = {
    overview: `${month} 共归档 ${items.length} 条动态，覆盖 ${groupByTrack(items).size} 个赛道。（LLM 未启用，本段为模板综述）`,
    verdict: '（LLM 未启用，暂无竞争格局判断）',
    outlook: ['（LLM 未启用，暂无预判）'],
    focus: {},
  };
  if (!llmAvailable() || items.length === 0) return fallback;
  try {
    const raw = await chat(
      `你是 AI 行业战略分析师，正在撰写 ${month} 月报。基于给定情报条目输出严格 JSON（无其他文字）：
{
 "overview": "<本月宏观趋势综述，中文 200-300 字，只能基于给定条目归纳，禁止编造未出现的事件>",
 "verdict": "<竞争格局小结：本月谁在进攻、谁在防守、哪些赛道在升温，中文 100-150 字>",
 "outlook": ["<下月看点预判，2-3 条，必须由本月已出现的线索外推>"],
 "focus": {"openai": "<该公司本月战略重心一句话判断>", "google": "...", "anthropic": "...", "meta": "...", "microsoft": "..."}
}
focus 中只包含本月确有动作的公司，没有动作的公司省略其键。`,
      compactForLlm(items, 120),
      { strong: true }, // PRD：月报启用强模型
    );
    const parsed = parseJsonResponse<MonthlyNarrative>(raw);
    if (parsed.overview) {
      return {
        overview: parsed.overview,
        verdict: parsed.verdict ?? fallback.verdict,
        outlook: parsed.outlook?.slice(0, 3) ?? [],
        focus: parsed.focus ?? {},
      };
    }
  } catch (err) {
    console.warn('[monthly] LLM 叙事生成失败，使用模板降级:', String(err));
  }
  return fallback;
}

/** 月内三段：月初 1-10 / 月中 11-20 / 月末 21+ */
function phaseOf(date: string): '月初' | '月中' | '月末' {
  const day = Number(date.slice(8, 10));
  if (day <= 10) return '月初';
  if (day <= 20) return '月中';
  return '月末';
}

function trackTimeline(track: Track, items: InsightItem[]): string[] {
  const lines: string[] = [`### 赛道：${trackLabel(track)}`, ''];
  const sorted = [...items].sort((a, b) => a.publish_date.localeCompare(b.publish_date));
  const byPhase = new Map<string, InsightItem[]>();
  for (const item of sorted) {
    const phase = phaseOf(item.publish_date);
    if (!byPhase.has(phase)) byPhase.set(phase, []);
    byPhase.get(phase)!.push(item);
  }
  for (const phase of ['月初', '月中', '月末']) {
    for (const item of (byPhase.get(phase) ?? []).slice(0, 3)) {
      const improvement = item.ai_tags?.improvement;
      lines.push(
        `- ${phase}（${item.publish_date}）：${mdLink(item)}${improvement ? ` — ${improvement}` : ''}`,
      );
    }
  }
  const keywords = [
    ...new Set(sorted.flatMap((i) => i.ai_tags?.keywords ?? [])),
  ].slice(0, 5);
  if (keywords.length > 0) lines.push(`\n→ 本月该赛道高频方向：${keywords.join('、')}`);
  lines.push('');
  return lines;
}

export async function buildMonthlyReport(month: string, allItems: InsightItem[]): Promise<string> {
  // 与周报同一道相关性门槛；历史归档缺 relevance 字段时默认放行
  const items = allItems.filter((i) => (i.ai_tags?.relevance ?? 3) >= MIN_REPORT_RELEVANCE);
  const { overview, verdict, outlook, focus } = await narrative(month, items);

  const lines: string[] = [`# AI 情报月报 | ${month}`, ''];

  lines.push('## 📌 本月综述', '', overview, '');

  lines.push('## 🗺️ 技术演进图谱', '');
  const byTrack = groupByTrack(items);
  // 按条目数降序展示，最多 5 个赛道，other 不单独成节
  const tracks = [...byTrack.entries()]
    .filter(([t]) => t !== 'other')
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 5);
  if (tracks.length === 0) {
    lines.push('本月归档数据不足，无法绘制演进图谱。', '');
  } else {
    for (const [track, trackItems] of tracks) lines.push(...trackTimeline(track, trackItems));
  }

  lines.push('## 🏢 大厂竞争格局月报', '');
  const companyItems = groupByCompany(items.filter((i) => i.company !== 'other'));
  if (companyItems.size === 0) {
    lines.push('本月未捕获大厂公开动作。', '');
  } else {
    lines.push(
      '| 公司 | 本月关键发布 | 战略重心判断 | 生态动作 |',
      '|------|-------------|-------------|----------|',
    );
    for (const company of orderedCompanies(companyItems.keys())) {
      const list = companyItems.get(company)!;
      const key = list
        .filter((i) => i.source === 'blog')
        .concat(list.filter((i) => i.source === 'github'))
        .slice(0, 3)
        .map((i) => mdLink(i))
        .join('；');
      const eco = list.filter((i) => i.source === 'github').length;
      lines.push(
        `| ${companyLabel(company)} | ${key || '—'} | ${focus[company] ?? '—'} | 开源/发布 ${eco} 项 |`,
      );
    }
    lines.push('');
  }

  lines.push('## 📊 竞争格局小结', '', verdict, '');

  lines.push('## 🔭 下月看点预判', '');
  (outlook.length > 0 ? outlook : ['暂无']).forEach((o, i) => lines.push(`${i + 1}. ${o}`));
  lines.push('');

  lines.push('---', '');
  lines.push(
    `> 数据来源：${month} 各周归档（data/）｜ 条目数：${items.length} ｜ 由 ai-insight-dashboard 自动生成`,
    '',
  );
  return lines.join('\n');
}
