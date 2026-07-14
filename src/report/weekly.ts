import type { InsightItem } from '../types.js';
import {
  COMPANY_ORDER,
  FOCUS_DIRECTIONS,
  MIN_REPORT_RELEVANCE,
  RESEARCH_DIRECTIONS,
} from '../config.js';
import { chat, llmAvailable, parseJsonResponse } from '../analysis/llm.js';
import { ymd } from '../util/dates.js';
import { companyLabel, displayTitle, groupByCompany, mdLink } from './common.js';

const MAX_DIRECTIONS = 8;
const MAX_ITEMS_PER_DIRECTION = 4;

const DIRECTION_LABELS = new Map(RESEARCH_DIRECTIONS.map((d) => [d.id, d.label]));

interface WeeklyNarrative {
  tldr: string[];
  /** 头条条目 id + 为什么重要 */
  headlines: Array<{ id: string; why: string }>;
  direction_summaries: Record<string, string>;
  company_signals: Record<string, string>;
  watch: string[];
}

const NARRATIVE_PROMPT = `你是 AI 行业战略分析师，为技术决策者撰写周报的编辑判断部分。基于给定的本周情报条目（已含赛道 track、研究方向 directions、相关性 relevance），输出严格 JSON（无其他文字、无代码围栏）：
{
 "tldr": ["<本周要点，3 条，每条 ≤40 字，覆盖最重要的变化>"],
 "headlines": [{"id": "<从输入中选出本周最重要的 1-3 条的 id>", "why": "<为什么重要：对行业格局/技术路线/竞争态势的影响判断，一句话。禁止复述条目本身做了什么（improvement 字段已有），必须给出增量判断，如'谁受影响、改变什么趋势、和谁形成竞争'>"}],
 "direction_summaries": {"<direction id>": "<该方向本周小结：发生了什么、往哪个方向演进，一句话>"},
 "company_signals": {"<company>": "<该公司本周战略信号的一句话判断，如'以客户案例为 DevDay 造势'>"},
 "watch": ["<下周值得关注的节点，1-2 条，仅可基于给定条目中已出现的线索，禁止编造>"]
}
规则：headlines 优先选 relevance=5 的重大发布与方向性突破；direction_summaries 只写条目数 ≥2 的方向；company_signals 只写本周确有动作的公司；所有判断只能基于给定条目归纳。`;

async function narrative(items: InsightItem[]): Promise<WeeklyNarrative> {
  const top = [...items].sort(
    (a, b) => (b.ai_tags?.relevance ?? 3) - (a.ai_tags?.relevance ?? 3),
  );
  const fallback: WeeklyNarrative = {
    tldr: [
      `本周共追踪 ${items.length} 条高相关动态（arXiv/GitHub/官方博客）`,
      '（LLM 未启用，本区为模板降级输出）',
    ],
    headlines: top.slice(0, 1).map((i) => ({ id: i.id, why: '' })),
    direction_summaries: {},
    company_signals: {},
    watch: [],
  };
  if (!llmAvailable() || items.length === 0) return fallback;
  try {
    const payload = top.slice(0, 60).map((i) => ({
      id: i.id,
      company: i.company,
      source: i.source,
      track: i.ai_tags?.track,
      directions: i.ai_tags?.directions ?? [],
      relevance: i.ai_tags?.relevance ?? 3,
      title: displayTitle(i),
      improvement: i.ai_tags?.improvement,
    }));
    const raw = await chat(NARRATIVE_PROMPT, JSON.stringify(payload, null, 1));
    const parsed = parseJsonResponse<WeeklyNarrative>(raw);
    if (parsed.tldr?.length) {
      return {
        tldr: parsed.tldr.slice(0, 3),
        headlines: (parsed.headlines ?? []).slice(0, 3),
        direction_summaries: parsed.direction_summaries ?? {},
        company_signals: parsed.company_signals ?? {},
        watch: (parsed.watch ?? []).slice(0, 2),
      };
    }
  } catch (err) {
    console.warn('[weekly] LLM 叙事生成失败，使用模板降级:', String(err));
  }
  return fallback;
}

function signalMark(item: InsightItem): string {
  const r = item.ai_tags?.relevance ?? 3;
  if (r >= 5) return '🔥 ';
  if (r >= 4) return '⭐ ';
  return '';
}

function itemLine(item: InsightItem): string {
  const src = item.source === 'arxiv' ? 'arXiv' : item.source === 'github' ? 'GitHub' : '博客';
  const who = item.company === 'other' ? src : `${src}/${companyLabel(item.company)}`;
  const desc = item.ai_tags?.improvement ?? '';
  return `- ${signalMark(item)}**${displayTitle(item)}**（${who}）${desc ? ` — ${desc}` : ''} [原文](${item.url})`;
}

/** 按主方向（directions[0]）聚类；关注方向置顶，其余按条目数降序 */
function groupByDirection(items: InsightItem[]): Array<[string, InsightItem[]]> {
  const map = new Map<string, InsightItem[]>();
  for (const item of items) {
    const dir = item.ai_tags?.directions?.[0];
    if (!dir) continue;
    if (!map.has(dir)) map.set(dir, []);
    map.get(dir)!.push(item);
  }
  const entries = [...map.entries()];
  entries.sort((a, b) => {
    const fa = FOCUS_DIRECTIONS.includes(a[0]) ? 1 : 0;
    const fb = FOCUS_DIRECTIONS.includes(b[0]) ? 1 : 0;
    if (fa !== fb) return fb - fa;
    return b[1].length - a[1].length;
  });
  return entries.slice(0, MAX_DIRECTIONS);
}

export async function buildWeeklyReport(allItems: InsightItem[], runDate: Date): Promise<string> {
  const date = ymd(runDate);
  // 相关性门槛：低价值条目（客户案例/公关文）只归档不进报告
  const items = allItems.filter((i) => (i.ai_tags?.relevance ?? 3) >= MIN_REPORT_RELEVANCE);
  const filtered = allItems.length - items.length;

  const n = await narrative(items);
  const byId = new Map(items.map((i) => [i.id, i]));
  const headlineIds = new Set(n.headlines.map((h) => h.id).filter((id) => byId.has(id)));

  const lines: string[] = [`# AI 情报周报 | ${date}`, ''];

  // 本周要点
  lines.push('## 📌 本周要点', '');
  for (const t of n.tldr) lines.push(`- ${t}`);
  lines.push('');

  // 本周头条
  if (headlineIds.size > 0) {
    lines.push('## 🎯 本周头条', '');
    for (const h of n.headlines) {
      const item = byId.get(h.id);
      if (!item) continue;
      lines.push(`### ${displayTitle(item)}`, '');
      const what = item.ai_tags?.improvement ?? '';
      const parts: string[] = [];
      if (what) parts.push(`**发生了什么**：${what}`);
      if (h.why) parts.push(`**为什么重要**：${h.why}`);
      if (parts.length > 0) lines.push(parts.join(' ｜ '));
      const src =
        item.company === 'other'
          ? item.source === 'arxiv'
            ? 'arXiv'
            : item.source
          : companyLabel(item.company);
      lines.push(`[原文](${item.url})（${src}）`, '');
    }
  }

  // 研究方向雷达（头条条目不重复出现）
  lines.push('## 🔬 研究方向雷达', '');
  const radarItems = items.filter((i) => !headlineIds.has(i.id));
  const directions = groupByDirection(radarItems);
  // 关注方向本周无信号时显式提示，避免读者误以为漏采
  const activeDirs = new Set(directions.map(([d]) => d));
  const quietFocus = FOCUS_DIRECTIONS.filter((d) => !activeDirs.has(d));
  if (quietFocus.length > 0) {
    const shown = quietFocus.slice(0, 6).map((d) => DIRECTION_LABELS.get(d) ?? d);
    const more = quietFocus.length > shown.length ? ` 等 ${quietFocus.length} 个` : '';
    lines.push(`> ℹ️ 关注方向本周无高信号动态：${shown.join('、')}${more}`, '');
  }
  if (directions.length === 0) {
    lines.push('本周窗口内无满足信号阈值的方向性动态。', '');
  } else {
    for (const [dir, dirItems] of directions) {
      const label = DIRECTION_LABELS.get(dir) ?? dir;
      const focus = FOCUS_DIRECTIONS.includes(dir) ? ' 🎯' : '';
      lines.push(`### 📡 ${label}（本周 ${dirItems.length} 条）${focus}`, '');
      const summary = n.direction_summaries[dir];
      if (summary) lines.push(`> ${summary}`, '');
      const sorted = [...dirItems].sort(
        (a, b) => (b.ai_tags?.relevance ?? 3) - (a.ai_tags?.relevance ?? 3),
      );
      for (const item of sorted.slice(0, MAX_ITEMS_PER_DIRECTION)) lines.push(itemLine(item));
      lines.push('');
    }
  }

  // 大厂动态
  lines.push('## 🏢 大厂动态', '');
  const companyItems = groupByCompany(items.filter((i) => i.company !== 'other'));
  if (companyItems.size === 0) {
    lines.push('本周窗口内未捕获大厂公开动作。', '');
  } else {
    lines.push('| 公司 | 本周战略信号 | 关键动作 |', '|------|-------------|----------|');
    // 监控名单内的公司全部列出：无高信号动作也显式说明，与"漏采"区分
    for (const company of COMPANY_ORDER) {
      const list = [...(companyItems.get(company) ?? [])].sort(
        (a, b) => (b.ai_tags?.relevance ?? 3) - (a.ai_tags?.relevance ?? 3),
      );
      if (list.length === 0) {
        lines.push(`| ${companyLabel(company)} | 本周无高信号公开动作 | — |`);
        continue;
      }
      const signal = n.company_signals[company] ?? '—';
      const actions = list.slice(0, 3).map((i) => mdLink(i)).join('；');
      lines.push(`| ${companyLabel(company)} | ${signal} | ${actions} |`);
    }
    lines.push('');
  }

  // 下周关注
  lines.push('## 🔭 下周关注', '');
  for (const w of n.watch.length > 0 ? n.watch : ['暂无']) lines.push(`- ${w}`);
  lines.push('');

  lines.push('---', '');
  lines.push(
    `> 数据窗口：近 7 天 ｜ 入选 ${items.length} 条（arXiv ${count(items, 'arxiv')} / GitHub ${count(items, 'github')} / 博客 ${count(items, 'blog')}），另有 ${filtered} 条低相关条目已过滤（仅归档）｜ 由 ai-insight-dashboard 自动生成`,
    '',
  );
  return lines.join('\n');
}

function count(items: InsightItem[], source: string): number {
  return items.filter((i) => i.source === source).length;
}
