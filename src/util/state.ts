import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import type { State } from '../types.js';

const STATE_FILE = 'state.json';
const MAX_SEEN = 5000;

export function loadState(): State {
  if (!existsSync(STATE_FILE)) {
    return { seen_blog_urls: {}, seen_github_ids: [] };
  }
  const raw = JSON.parse(readFileSync(STATE_FILE, 'utf8')) as Partial<State>;
  return {
    last_weekly_run: raw.last_weekly_run,
    seen_blog_urls: raw.seen_blog_urls ?? {},
    seen_github_ids: raw.seen_github_ids ?? [],
  };
}

export function saveState(state: State): void {
  // 防止 seen 集合无限膨胀：只保留最近的条目
  for (const key of Object.keys(state.seen_blog_urls)) {
    state.seen_blog_urls[key] = state.seen_blog_urls[key].slice(-MAX_SEEN);
  }
  state.seen_github_ids = state.seen_github_ids.slice(-MAX_SEEN);
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + '\n');
}
