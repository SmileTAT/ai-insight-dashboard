import type { InsightItem } from '../types.js';
import { chat, llmAvailable, parseJsonResponse } from '../analysis/llm.js';
import { ymd } from '../util/dates.js';
import {
  companyLabel,
  compactForLlm,
  groupByCompany,
  groupByTrack,
  mdLink,
  orderedCompanies,
  trackLabel,
} from './common.js';

const HIGHLIGHT_LIMIT = 8;

interface WeeklyNarrative {
  summary: string;
  watch: string[];
}

async function narrative(items: InsightItem[]): Promise<WeeklyNarrative> {
  const fallback: WeeklyNarrative = {
    summary: `本周共追踪 ${items.length} 条动态，覆盖 ${groupByTrack(items).size} 个赛道、${groupByCompany(items).size} 个主体。`,
    watch: ['（LLM 未启用，暂无预判）'],
  };
  if (!llmAvailable() || items.length === 0) return fallback;
  try {
    const raw = await chat(
      `你是 AI 行业战略分析师。基于给定的本周情报条目，输出严格 JSON（无其他文字）：
{"summary": "<一句话概括本周行业最重要的变化，中文，50 字内>", "watch": ["<下周值得关注的节点，1-2 条，仅可基于给定条目中已出现的线索，禁止编造>"]}`,
      compactForLlm(items, 60),
    );
    const parsed = parseJsonResponse<WeeklyNarrative>(raw);
    if (parsed.summary) return { summary: parsed.summary, watch: parsed.watch?.slice(0, 2) ?? [] };
  } catch (err) {
    console.warn('[weekly] LLM 叙事生成失败，使用模板降级:', String(err));
  }
  return fallback;
}

/** 技术迭代亮点：每赛道最多 2 条，优先大厂发布与高分论文 */
function pickHighlights(items: InsightItem[]): InsightItem[] {
  const scored = [...items].sort((a, b) => {
    const pa = (a.company !== 'other' ? 100 : 0) + (a.signal_score ?? 0);
    const pb = (b.company !== 'other' ? 100 : 0) + (b.signal_score ?? 0);
    return pb - pa;
  });
  const perTrack = new Map<string, number>();
  const picked: InsightItem[] = [];
  for (const item of scored) {
    const track = item.ai_tags?.track ?? 'other';
    const count = perTrack.get(track) ?? 0;
    if (count >= 2) continue;
    perTrack.set(track, count + 1);
    picked.push(item);
    if (picked.length >= HIGHLIGHT_LIMIT) break;
  }
  return picked;
}

export async function buildWeeklyReport(items: InsightItem[], runDate: Date): Promise<string> {
  const date = ymd(runDate);
  const { summary, watch } = await narrative(items);

  const lines: string[] = [`# AI 情报周报 | ${date}`, ''];

  lines.push('## 📌 本周一句话总结', '', summary, '');

  lines.push('## 🔬 技术迭代亮点', '');
  const highlights = pickHighlights(items);
  if (highlights.length === 0) {
    lines.push('本周窗口内无满足信号阈值的技术动态。', '');
  } else {
    for (const item of highlights) {
      const improvement = item.ai_tags?.improvement ?? '首次追踪，暂无前序对比';
      lines.push(`- **${trackLabel(item.ai_tags?.track)}**：${mdLink(item)} — ${improvement}`);
    }
    lines.push('');
  }

  lines.push('## 🏢 大厂动态汇总', '');
  const companyItems = groupByCompany(items.filter((i) => i.company !== 'other'));
  if (companyItems.size === 0) {
    lines.push('本周窗口内未捕获大厂公开动作。', '');
  } else {
    lines.push('| 公司 | 本周动作 | 涉及赛道 |', '|------|----------|----------|');
    for (const company of orderedCompanies(companyItems.keys())) {
      const list = companyItems.get(company)!;
      const actions = list
        .slice(0, 3)
        .map((i) => mdLink(i))
        .join('；');
      const extra = list.length > 3 ? ` 等 ${list.length} 项` : '';
      const tracks = [...new Set(list.map((i) => trackLabel(i.ai_tags?.track)))].join('、');
      lines.push(`| ${companyLabel(company)} | ${actions}${extra} | ${tracks} |`);
    }
    lines.push('');
  }

  lines.push('## 🔭 下周关注', '');
  for (const w of watch.length > 0 ? watch : ['暂无']) lines.push(`- ${w}`);
  lines.push('');

  lines.push('---', '');
  lines.push(
    `> 数据窗口：近 7 天 ｜ 条目数：${items.length}（arXiv ${count(items, 'arxiv')} / GitHub ${count(items, 'github')} / 博客 ${count(items, 'blog')}）｜ 由 ai-insight-dashboard 自动生成`,
    '',
  );
  return lines.join('\n');
}

function count(items: InsightItem[], source: string): number {
  return items.filter((i) => i.source === source).length;
}
