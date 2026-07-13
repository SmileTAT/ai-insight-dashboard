import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadItemsForMonth } from './archive.js';
import { buildMonthlyReport } from './report/monthly.js';
import { llmUsage } from './analysis/llm.js';
import { previousMonth } from './util/dates.js';

async function main(): Promise<void> {
  // 每月 1 日运行，覆盖上一个自然月；可用 REPORT_MONTH=YYYY-MM 手动补跑任意月份
  // （定时触发时 CI 注入的 inputs 为空字符串，须用 || 兜底）
  const month = process.env.REPORT_MONTH || previousMonth();
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error(`REPORT_MONTH 格式应为 YYYY-MM，得到：${month}`);

  const items = loadItemsForMonth(month);
  console.log(`[monthly] ${month} 归档条目：${items.length}`);
  if (items.length === 0) {
    console.warn('[monthly] 该月无归档数据，将生成空数据说明报告');
  }

  const report = await buildMonthlyReport(month, items);
  mkdirSync(join('reports', 'monthly'), { recursive: true });
  const reportFile = join('reports', 'monthly', `${month}.md`);
  writeFileSync(reportFile, report);
  console.log(`[monthly] 月报已生成 → ${reportFile}`);

  const usage = llmUsage();
  console.log(`[monthly] LLM 用量：${usage.requests} 次请求 / ${usage.total_tokens} tokens`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
