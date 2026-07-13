# ai-insight-dashboard

战略级 AI 情报系统：自动追踪**技术路线图演进**与**大厂竞争格局**，每周/每月产出结构化深度报告。

- 📄 产品需求文档：[docs/PRD.md](docs/PRD.md)
- 📊 周报：[reports/weekly/](reports/weekly/) ｜ 月报：[reports/monthly/](reports/monthly/)

## 工作原理

```
┌─ 采集 ────────────────┐   ┌─ 分析 ──────────────┐   ┌─ 产出 ─────────────┐
│ arXiv (cs.AI/LG/CL)   │   │ 两级漏斗精筛          │   │ 周报 reports/weekly │
│ GitHub 大厂组织监控    │ → │ LLM 赛道归类          │ → │ 月报 reports/monthly│
│ 官方博客 sitemap/RSS   │   │ 改进点提炼（防编造）   │   │ 原始数据 data/      │
└───────────────────────┘   └─────────────────────┘   └────────────────────┘
```

- **周报**：每周一 00:00 UTC（北京时间 08:00）由 GitHub Actions 自动生成，采集近 7 天数据 → 分析 → 归档 → 生成报告 → 自动 commit。
- **月报**：每月 1 日聚合上月各周归档数据（`data/YYYY/week-WW/`），不重新采集。
- **告警**：流水线失败自动创建带 `pipeline-failure` 标签的 Issue。
- **降级**：LLM 不可用时自动退化为启发式关键词归类，流水线永不因 LLM 中断。

## 配置

### Secrets（仓库 Settings → Secrets and variables → Actions）

| 名称 | 必填 | 说明 |
| :--- | :--- | :--- |
| `LLM_API_KEY` | 建议 | 任意 OpenAI-compatible API 的 Key；缺省时降级为启发式归类（报告质量显著下降） |

### Variables（可选）

| 名称 | 默认值 | 说明 |
| :--- | :--- | :--- |
| `LLM_BASE_URL` | `https://api.deepseek.com/v1` | OpenAI-compatible 端点 |
| `LLM_MODEL` | `deepseek-chat` | 周报/批量归类模型（低成本优先） |
| `LLM_STRONG_MODEL` | 同 `LLM_MODEL` | 月报综述模型（可配更强模型） |

### 运行参数（环境变量，均有默认值）

`WINDOW_DAYS`（采集窗口，默认 7）、`ARXIV_LLM_LIMIT`（每周进入 LLM 分析的论文上限，默认 50）、`ARXIV_CANDIDATE_LIMIT`（粗筛候选池上限，默认 200）、`ARXIV_MAX_PAGES`（API 分页上限，默认 10）。

监控的组织/博客/关键词清单在 [`src/config.ts`](src/config.ts) 中维护。

## 本地运行

```bash
npm install
LLM_API_KEY=sk-xxx npm run weekly              # 生成本周周报
LLM_API_KEY=sk-xxx REPORT_MONTH=2026-06 npm run monthly  # 补跑指定月份月报
npm run typecheck                              # 类型检查
npm run test:e2e                               # 端到端测试（本地 fixture，不访问外网）
```

## 手动补跑

Actions 页面 → 选择 Weekly Report / Monthly Report → Run workflow。月报支持 `report_month` 参数（YYYY-MM）补跑任意月份。

## 目录结构

```
src/
  collectors/   arxiv.ts github.ts blog.ts   # 三类数据源采集器
  analysis/     llm.ts classify.ts           # LLM Provider 抽象 + 赛道归类
  report/       weekly.ts monthly.ts         # 报告生成器
  run-weekly.ts run-monthly.ts               # 流水线入口
data/YYYY/week-WW/items.json                 # 原始数据周归档（月报数据基础）
reports/weekly/ reports/monthly/             # 报告产出
state.json                                   # 采集游标与差分基线
```
