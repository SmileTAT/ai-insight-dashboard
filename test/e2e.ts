/**
 * 端到端冒烟测试：本地 fixture 服务器模拟 arXiv / GitHub / 博客 / LLM API，
 * 以子进程跑完整周报+月报流水线，断言报告与归档产物。
 * 运行：npm run test:e2e
 */
import assert from 'node:assert';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const today = new Date();
const iso = today.toISOString();
const ymd = iso.slice(0, 10);
const month = iso.slice(0, 7);

// ---------- fixtures ----------

const ATOM = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>http://arxiv.org/abs/2607.00001v1</id>
    <title>MoE-X: Scaling Mixture-of-Experts Language Models</title>
    <summary>We present a mixture of experts foundation model that outperforms dense baselines on reasoning benchmarks with state-of-the-art results.</summary>
    <published>${iso}</published>
  </entry>
  <entry>
    <id>http://arxiv.org/abs/2607.00002v1</id>
    <title>AgentBench-2: A Benchmark for Tool Use Agents</title>
    <summary>A new benchmark evaluating agent tool use and long context planning.</summary>
    <published>${iso}</published>
  </entry>
  <entry>
    <id>http://arxiv.org/abs/2607.00003v1</id>
    <title>On the Homology of Certain Manifolds</title>
    <summary>A pure mathematics paper with no relevant terms.</summary>
    <published>${iso}</published>
  </entry>
</feed>`;

const repos = (org: string) =>
  org === 'openai'
    ? [
        {
          full_name: 'openai/new-agent-sdk',
          html_url: 'https://github.com/openai/new-agent-sdk',
          description: 'An SDK for building agents',
          created_at: iso,
          fork: false,
        },
      ]
    : [];

const events = (org: string) =>
  org === 'anthropics'
    ? [
        {
          type: 'ReleaseEvent',
          created_at: iso,
          repo: { name: 'anthropics/claude-sdk' },
          payload: {
            action: 'published',
            release: {
              tag_name: 'v2.0.0',
              name: 'Claude SDK 2.0',
              body: 'Adds computer use tool support',
              html_url: 'https://github.com/anthropics/claude-sdk/releases/v2.0.0',
              published_at: iso,
            },
          },
        },
      ]
    : [];

const llmClassify = (userContent: string) => {
  const items = JSON.parse(userContent) as Array<{ id: string }>;
  return JSON.stringify(
    items.map((i) => ({
      id: i.id,
      track: i.id.startsWith('arxiv:') ? 'foundation-model' : 'agent',
      keywords: i.id.startsWith('arxiv:') ? ['MoE'] : ['tool use'],
      improvement: i.id.startsWith('arxiv:2607.00001')
        ? '以 MoE 架构超越稠密基线'
        : '首次追踪，暂无前序对比',
    })),
  );
};

// ---------- fixture server ----------

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => resolve(data));
  });
}

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  const send = (body: string, type = 'application/json') => {
    res.writeHead(200, { 'content-type': type });
    res.end(body);
  };

  if (url.pathname === '/arxiv') {
    // 第二页返回空 feed，结束分页
    if (url.searchParams.get('start') !== '0') {
      return send('<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"></feed>', 'application/atom+xml');
    }
    return send(ATOM, 'application/atom+xml');
  }
  const orgRepos = url.pathname.match(/^\/orgs\/([^/]+)\/repos$/);
  if (orgRepos) return send(JSON.stringify(repos(orgRepos[1])));
  const orgEvents = url.pathname.match(/^\/orgs\/([^/]+)\/events$/);
  if (orgEvents) return send(JSON.stringify(events(orgEvents[1])));
  if (url.pathname === '/sitemap.xml') {
    return send(
      `<?xml version="1.0"?><urlset><url><loc>http://127.0.0.1:${port}/news/gpt-6-announcement</loc><lastmod>${ymd}</lastmod></url></urlset>`,
      'application/xml',
    );
  }
  if (url.pathname.startsWith('/news/')) {
    return send(
      '<html><head><title>Introducing GPT-6</title><meta name="description" content="Our most capable model."></head></html>',
      'text/html',
    );
  }
  if (url.pathname === '/v1/chat/completions') {
    const body = JSON.parse(await readBody(req)) as {
      messages: Array<{ role: string; content: string }>;
    };
    const system = body.messages[0].content;
    const user = body.messages[1].content;
    let content: string;
    if (system.includes('对每条输入')) content = llmClassify(user);
    else if (system.includes('月报')) {
      content = JSON.stringify({
        overview: '本月 Agent 赛道显著升温。',
        verdict: 'OpenAI 与 Anthropic 在 Agent 基础设施上正面竞争。',
        outlook: ['关注 Agent SDK 生态扩张'],
        focus: { openai: '押注 Agent SDK', anthropic: '强化工具调用能力' },
      });
    } else {
      content = JSON.stringify({
        summary: '本周 Agent 工具链密集发布。',
        watch: ['OpenAI Agent SDK 后续版本'],
      });
    }
    return send(
      JSON.stringify({
        choices: [{ message: { content } }],
        usage: { total_tokens: 100 },
      }),
    );
  }
  res.writeHead(404);
  res.end('not found');
});

await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = (server.address() as { port: number }).port;
const base = `http://127.0.0.1:${port}`;

// ---------- run pipelines in a temp workdir ----------

const workdir = mkdtempSync(join(tmpdir(), 'aiid-e2e-'));
const blogSourcesFile = join(workdir, 'blog-sources.json');
writeFileSync(
  blogSourcesFile,
  JSON.stringify([
    { id: 'openai-news', company: 'openai', type: 'sitemap', url: `${base}/sitemap.xml`, include: '/news/' },
  ]),
);

const env = {
  ...process.env,
  NO_PROXY: '127.0.0.1',
  ARXIV_API_BASE: `${base}/arxiv`,
  GITHUB_API_BASE: base,
  BLOG_SOURCES_FILE: blogSourcesFile,
  LLM_API_KEY: 'test-key',
  LLM_BASE_URL: `${base}/v1`,
  ARXIV_MAX_PAGES: '2',
  GITHUB_TOKEN: '',
};

const repoRoot = join(import.meta.dirname, '..');
const tsxBin = join(repoRoot, 'node_modules', '.bin', 'tsx');
const execFileAsync = promisify(execFile);
// 注意：必须用异步 execFile —— fixture 服务器跑在本进程，
// 同步 spawn 会阻塞事件循环导致子进程请求 fixture 时死锁
const run = async (script: string, extraEnv: Record<string, string> = {}) => {
  const { stdout, stderr } = await execFileAsync(tsxBin, [join(repoRoot, 'src', script)], {
    cwd: workdir,
    env: { ...env, ...extraEnv },
    encoding: 'utf8',
    timeout: 120_000,
  });
  if (stdout) console.log(stdout);
  if (stderr) console.error(stderr);
};

console.log('--- run weekly ---');
await run('run-weekly.ts');

const weeklyFile = join(workdir, 'reports', 'weekly', `${ymd}.md`);
assert.ok(existsSync(weeklyFile), '周报文件应存在');
const weekly = readFileSync(weeklyFile, 'utf8');
assert.match(weekly, /本周 Agent 工具链密集发布/, '周报应包含 LLM 一句话总结');
assert.match(weekly, /MoE-X/, '周报应包含高信号 arXiv 论文');
assert.match(weekly, /以 MoE 架构超越稠密基线/, '周报应包含改进点提炼');
assert.match(weekly, /openai\/new-agent-sdk/, '周报应包含 GitHub 新仓库');
assert.match(weekly, /Claude SDK 2\.0/, '周报应包含 Release');
assert.match(weekly, /Introducing GPT-6/, '周报应包含博客文章');
assert.match(weekly, /OpenAI Agent SDK 后续版本/, '周报应包含下周关注');
assert.ok(!weekly.includes('Homology'), '零信号论文应被一级漏斗过滤');

const archiveFiles = readFileSync(join(workdir, 'state.json'), 'utf8');
assert.match(archiveFiles, /github:repo:openai\/new-agent-sdk/, 'state 应记录已见 GitHub 条目');

console.log('--- run weekly again (idempotency) ---');
await run('run-weekly.ts');

console.log('--- run monthly ---');
await run('run-monthly.ts', { REPORT_MONTH: month });

const monthlyFile = join(workdir, 'reports', 'monthly', `${month}.md`);
assert.ok(existsSync(monthlyFile), '月报文件应存在');
const monthly = readFileSync(monthlyFile, 'utf8');
assert.match(monthly, /本月 Agent 赛道显著升温/, '月报应包含综述');
assert.match(monthly, /押注 Agent SDK/, '月报应包含战略重心判断');
assert.match(monthly, /MoE-X/, '月报应聚合周归档数据');
assert.match(monthly, /下月看点预判/, '月报应包含预判章节');

server.close();
console.log(`\nE2E PASS ✅  (workdir: ${workdir})`);
