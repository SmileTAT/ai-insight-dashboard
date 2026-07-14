/**
 * GitHub Pages 静态站生成器。
 * 只转换本项目自己生成的 markdown 语法子集（标题/列表/表格/引用/粗体/链接/分隔线），
 * 不引第三方 md 解析依赖；页面零外部请求（内联 CSS，无 JS）。
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SITE_DIR = 'docs';

function escapeHtml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

/** 行内语法：粗体与链接（先转义，再还原受控标记） */
function inline(raw: string): string {
  let s = escapeHtml(raw);
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(
    /\[([^\]]+)\]\((https?:[^)\s]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener">$1</a>',
  );
  return s;
}

/** 受限 markdown → HTML 主体（仅支持本项目产出的语法子集） */
export function markdownToHtml(md: string): string {
  const lines = md.split('\n');
  const out: string[] = [];
  let inList = false;
  let inQuote = false;
  let table: string[][] | null = null;

  const closeList = () => {
    if (inList) {
      out.push('</ul>');
      inList = false;
    }
  };
  const closeQuote = () => {
    if (inQuote) {
      out.push('</blockquote>');
      inQuote = false;
    }
  };
  const flushTable = () => {
    if (!table) return;
    const [head, ...rows] = table;
    out.push('<div class="table-wrap"><table>');
    out.push('<thead><tr>' + head.map((c) => `<th>${inline(c)}</th>`).join('') + '</tr></thead>');
    out.push('<tbody>');
    for (const row of rows) {
      out.push('<tr>' + row.map((c) => `<td>${inline(c)}</td>`).join('') + '</tr>');
    }
    out.push('</tbody></table></div>');
    table = null;
  };

  for (const line of lines) {
    const t = line.trimEnd();

    // 表格行（跳过分隔行 |---|）
    if (t.startsWith('|')) {
      closeList();
      closeQuote();
      if (/^\|[\s:|-]+\|$/.test(t)) continue;
      const cells = t.slice(1, t.endsWith('|') ? -1 : undefined).split('|').map((c) => c.trim());
      if (!table) table = [];
      table.push(cells);
      continue;
    }
    flushTable();

    if (t === '') {
      closeList();
      closeQuote();
      continue;
    }
    const h = t.match(/^(#{1,3})\s+(.*)$/);
    if (h) {
      closeList();
      closeQuote();
      const level = h[1].length;
      out.push(`<h${level}>${inline(h[2])}</h${level}>`);
      continue;
    }
    if (t === '---') {
      closeList();
      closeQuote();
      out.push('<hr>');
      continue;
    }
    if (t.startsWith('> ')) {
      closeList();
      if (!inQuote) {
        out.push('<blockquote>');
        inQuote = true;
      }
      out.push(`<p>${inline(t.slice(2))}</p>`);
      continue;
    }
    if (t.startsWith('- ')) {
      closeQuote();
      if (!inList) {
        out.push('<ul>');
        inList = true;
      }
      out.push(`<li>${inline(t.slice(2))}</li>`);
      continue;
    }
    closeList();
    closeQuote();
    out.push(`<p>${inline(t)}</p>`);
  }
  closeList();
  closeQuote();
  flushTable();
  return out.join('\n');
}

const CSS = `
:root{--bg:#fafaf8;--fg:#1a1a1a;--muted:#6b6b6b;--card:#ffffff;--line:#e6e3dd;--accent:#b45309;--accent-soft:#fef3e2;--quote:#f5f1ea;--link:#0f5ea8}
@media(prefers-color-scheme:dark){:root{--bg:#141414;--fg:#e8e6e1;--muted:#9a988f;--card:#1e1e1c;--line:#33312c;--accent:#f59e0b;--accent-soft:#2a2010;--quote:#232019;--link:#7db8e8}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.75 -apple-system,"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif}
nav{position:sticky;top:0;background:var(--bg);border-bottom:1px solid var(--line);padding:.7rem 1rem;display:flex;gap:1.2rem;align-items:baseline;z-index:9}
nav .brand{font-weight:700;color:var(--fg);text-decoration:none}
nav a{color:var(--muted);text-decoration:none;font-size:.9rem}
nav a:hover{color:var(--accent)}
main{max-width:46rem;margin:0 auto;padding:1.5rem 1.2rem 4rem}
h1{font-size:1.7rem;line-height:1.35;margin:1rem 0 .4rem}
h2{font-size:1.25rem;margin:2.2rem 0 .8rem;padding-bottom:.35rem;border-bottom:2px solid var(--line)}
h3{font-size:1.05rem;margin:1.4rem 0 .5rem}
a{color:var(--link)}
ul{padding-left:1.2rem;margin:.4rem 0}
li{margin:.45rem 0}
blockquote{margin:.8rem 0;padding:.7rem 1rem;background:var(--quote);border-left:3px solid var(--accent);border-radius:0 8px 8px 0;color:var(--fg)}
blockquote p{margin:.2rem 0}
hr{border:none;border-top:1px solid var(--line);margin:2rem 0}
.table-wrap{overflow-x:auto;margin:.8rem 0}
table{border-collapse:collapse;width:100%;font-size:.92rem}
th,td{border:1px solid var(--line);padding:.5rem .7rem;text-align:left;vertical-align:top}
th{background:var(--accent-soft);white-space:nowrap}
.issue-list{list-style:none;padding:0}
.issue-list li{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:.9rem 1.1rem;margin:.6rem 0}
.issue-list a{font-weight:600;text-decoration:none}
.issue-list .meta{color:var(--muted);font-size:.85rem;margin-left:.6rem}
footer{color:var(--muted);font-size:.85rem;text-align:center;padding:2rem 0}
`;

export function pageShell(title: string, bodyHtml: string, depth: number): string {
  const root = depth === 0 ? '.' : '..';
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${CSS}</style>
</head>
<body>
<nav><a class="brand" href="${root}/index.html">AI 情报周刊</a><a href="${root}/index.html">往期</a></nav>
<main>
${bodyHtml}
</main>
<footer>由 <a href="https://github.com/SmileTAT/ai-insight-dashboard" target="_blank" rel="noopener">ai-insight-dashboard</a> 自动生成</footer>
</body>
</html>
`;
}

/** 把一份报告 markdown 渲染为独立页面 */
export function renderReportPage(mdPath: string, kind: 'weekly' | 'monthly'): string {
  const md = readFileSync(mdPath, 'utf8');
  const title = md.match(/^#\s+(.*)$/m)?.[1] ?? 'AI 情报报告';
  const name = mdPath.split('/').pop()!.replace(/\.md$/, '');
  const outDir = join(SITE_DIR, kind);
  mkdirSync(outDir, { recursive: true });
  const outFile = join(outDir, `${name}.html`);
  writeFileSync(outFile, pageShell(title, markdownToHtml(md), 1));
  return outFile;
}

interface IssueRef {
  kind: 'weekly' | 'monthly';
  name: string;
}

function listIssues(kind: 'weekly' | 'monthly'): IssueRef[] {
  const dir = join('reports', kind);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .sort()
    .reverse()
    .map((f) => ({ kind, name: f.replace(/\.md$/, '') }));
}

/** 提取最新一期的"本周要点"作为首页摘要 */
function latestSummary(latest: IssueRef | undefined): string {
  if (!latest) return '';
  const md = readFileSync(join('reports', latest.kind, `${latest.name}.md`), 'utf8');
  const section = md.split(/^## /m).find((s) => s.startsWith('📌'));
  if (!section) return '';
  const bullets = section
    .split('\n')
    .filter((l) => l.startsWith('- '))
    .slice(0, 3)
    .map((l) => `<li>${inline(l.slice(2))}</li>`)
    .join('');
  return bullets
    ? `<h2>最新一期要点（${escapeHtml(latest.name)}）</h2><ul>${bullets}</ul>
<p><a href="${latest.kind}/${latest.name}.html"><strong>阅读全文 →</strong></a></p>`
    : '';
}

/** 重建全站：所有报告页面 + 首页目录 */
export function rebuildSite(): string {
  mkdirSync(SITE_DIR, { recursive: true });
  writeFileSync(join(SITE_DIR, '.nojekyll'), '');

  const weekly = listIssues('weekly');
  const monthly = listIssues('monthly');
  for (const i of weekly) renderReportPage(join('reports', 'weekly', `${i.name}.md`), 'weekly');
  for (const i of monthly) renderReportPage(join('reports', 'monthly', `${i.name}.md`), 'monthly');

  const issueList = (title: string, issues: IssueRef[], total: number) =>
    issues.length === 0
      ? ''
      : `<h2>${title}</h2><ul class="issue-list">` +
        issues
          .map(
            (i, idx) =>
              `<li><a href="${i.kind}/${i.name}.html">${i.name}</a><span class="meta">第 ${total - idx} 期</span></li>`,
          )
          .join('') +
        '</ul>';

  const body = [
    '<h1>AI 情报周刊</h1>',
    '<p>自动追踪技术路线图演进与大厂竞争格局：arXiv 论文两级精筛、大厂 GitHub 与官方博客监控、AI 编辑判断。每周一更新。</p>',
    latestSummary(weekly[0]),
    issueList('往期周报', weekly, weekly.length),
    issueList('月报', monthly, monthly.length),
  ]
    .filter(Boolean)
    .join('\n');

  const indexFile = join(SITE_DIR, 'index.html');
  writeFileSync(indexFile, pageShell('AI 情报周刊', body, 0));
  return indexFile;
}
