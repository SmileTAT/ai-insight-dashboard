import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ARXIV_LLM_LIMIT, WINDOW_DAYS } from './config.js';
import { collectArxiv } from './collectors/arxiv.js';
import { collectGithub } from './collectors/github.js';
import { collectBlogs } from './collectors/blog.js';
import { classifyItems } from './analysis/classify.js';
import { llmUsage } from './analysis/llm.js';
import { archiveWeek, archivedIds } from './archive.js';
import { buildWeeklyReport } from './report/weekly.js';
import { rebuildSite } from './site/html.js';
import { loadState, saveState } from './util/state.js';
import { daysAgo, ymd } from './util/dates.js';
import type { InsightItem } from './types.js';

async function main(): Promise<void> {
  const now = new Date();
  const windowStart = daysAgo(WINDOW_DAYS, now);
  console.log(`[weekly] 窗口 ${ymd(windowStart)} → ${ymd(now)}`);

  const state = loadState();
  const seenGithub = new Set(state.seen_github_ids);

  const [arxivR, githubR, blogR] = await Promise.allSettled([
    collectArxiv(windowStart, now),
    collectGithub(windowStart, seenGithub),
    collectBlogs(windowStart, state),
  ]);

  const failures: string[] = [];
  const pick = (r: PromiseSettledResult<InsightItem[]>, name: string): InsightItem[] => {
    if (r.status === 'fulfilled') return r.value;
    failures.push(`${name}: ${String(r.reason)}`);
    console.error(`[weekly] ${name} 采集失败:`, r.reason);
    return [];
  };
  const arxivItems = pick(arxivR, 'arxiv');
  const githubItems = pick(githubR, 'github');
  const blogItems = pick(blogR, 'blog');

  if (failures.length === 3) {
    throw new Error(`全部数据源采集失败：\n${failures.join('\n')}`);
  }

  // 跨周去重：已归档过的条目不再重复分析与上报
  const known = archivedIds();
  const freshArxiv = arxivItems.filter((i) => !known.has(i.id));
  const freshOthers = [...githubItems, ...blogItems].filter((i) => !known.has(i.id));

  // PRD 5.2 二级漏斗：arXiv 只有 top-N 进入 LLM 完整分析，其余仅留元数据归档
  const analyzedArxiv = freshArxiv.slice(0, ARXIV_LLM_LIMIT);
  const metadataOnly = freshArxiv.slice(ARXIV_LLM_LIMIT);
  const toAnalyze = [...analyzedArxiv, ...freshOthers];
  console.log(
    `[weekly] 进入 LLM 分析 ${toAnalyze.length} 条（arXiv ${analyzedArxiv.length}，github/blog ${freshOthers.length}），仅归档元数据 ${metadataOnly.length} 条`,
  );

  await classifyItems(toAnalyze);

  const archiveFile = archiveWeek([...toAnalyze, ...metadataOnly], now);
  console.log(`[weekly] 已归档 → ${archiveFile}`);

  const report = await buildWeeklyReport(toAnalyze, now);
  mkdirSync(join('reports', 'weekly'), { recursive: true });
  const reportFile = join('reports', 'weekly', `${ymd(now)}.md`);
  writeFileSync(reportFile, report);
  console.log(`[weekly] 周报已生成 → ${reportFile}`);

  const indexFile = rebuildSite();
  console.log(`[weekly] 网页版已更新 → ${indexFile}`);

  state.last_weekly_run = now.toISOString();
  for (const i of githubItems) state.seen_github_ids.push(i.id);
  saveState(state);

  const usage = llmUsage();
  console.log(`[weekly] LLM 用量：${usage.requests} 次请求 / ${usage.total_tokens} tokens`);
  if (failures.length > 0) {
    console.warn(`[weekly] 注意：${failures.length} 个数据源失败（本次已跳过）：\n${failures.join('\n')}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
