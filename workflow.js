/**
 * claude-workflow-starter: weekly-ai-digest
 *
 * A minimal Claude Code Dynamic Workflow demonstrating the fan-out
 * parallel agents pattern (announced June 2, 2026).
 *
 * Trigger: ask Claude Code anything containing the word "workflow"
 * e.g. "Run the weekly-ai-digest workflow"
 *
 * Spawns 6 parallel agents — each checks one AI news source — then
 * merges, deduplicates, and writes a structured markdown digest.
 */

import { defineWorkflow, spawnAgent } from '@anthropic-ai/claude-code-workflows';

// ─── helpers ────────────────────────────────────────────────────────────────

/** ISO date string for N days ago */
function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split('T')[0];
}

/** fetch with hard timeout */
async function timedFetch(url, opts = {}, timeoutMs = 10_000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
    return res.json();
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

// ─── per-source agent tasks ──────────────────────────────────────────────────

const SOURCES = [
  {
    id: 'hackernews',
    label: '🟠 Hacker News',
    async fetch() {
      const ids = await timedFetch('https://hacker-news.firebaseio.com/v0/topstories.json');
      const top = await Promise.all(
        ids.slice(0, 5).map(id =>
          timedFetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`)
        )
      );
      return top
        .filter(s => s && s.url)
        .slice(0, 3)
        .map(s => ({ title: s.title, url: s.url, summary: `${s.score} pts · ${s.descendants ?? 0} comments` }));
    },
  },
  {
    id: 'github',
    label: '🐙 GitHub Trending (AI)',
    async fetch() {
      const since = daysAgo(7);
      const data = await timedFetch(
        `https://api.github.com/search/repositories?q=topic:ai+created:>${since}&sort=stars&order=desc&per_page=3`,
        { headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' } }
      );
      return data.items.map(r => ({
        title: r.full_name,
        url: r.html_url,
        summary: `⭐ ${r.stargazers_count} — ${(r.description ?? '').slice(0, 80)}`,
      }));
    },
  },
  {
    id: 'arxiv',
    label: '📄 arXiv cs.AI',
    async fetch() {
      const xml = await fetch(
        `https://export.arxiv.org/api/query?search_query=cat:cs.AI&sortBy=submittedDate&sortOrder=descending&max_results=3`,
        { signal: AbortSignal.timeout(10_000) }
      ).then(r => r.text());
      const entries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)];
      return entries.slice(0, 3).map(m => {
        const e = m[1];
        const title = (e.match(/<title>([\s\S]*?)<\/title>/) ?? [])[1]?.replace(/\s+/g, ' ').trim() ?? 'Untitled';
        const url   = (e.match(/<id>(.*?)<\/id>/) ?? [])[1]?.trim() ?? '';
        const summ  = (e.match(/<summary>([\s\S]*?)<\/summary>/) ?? [])[1]?.replace(/\s+/g, ' ').slice(0, 100).trim() ?? '';
        return { title, url, summary: summ };
      });
    },
  },
  {
    id: 'devto',
    label: '👩‍💻 dev.to / AI',
    async fetch() {
      const posts = await timedFetch('https://dev.to/api/articles?tag=ai&per_page=3');
      return posts.map(p => ({
        title: p.title,
        url: p.url,
        summary: `❤️ ${p.positive_reactions_count} · by @${p.user.username}`,
      }));
    },
  },
  {
    id: 'reddit',
    label: '🤖 r/MachineLearning',
    async fetch() {
      const data = await timedFetch(
        'https://www.reddit.com/r/MachineLearning/hot.json?limit=3',
        { headers: { 'User-Agent': 'claude-workflow-starter/1.0' } }
      );
      return data.data.children.map(c => ({
        title: c.data.title,
        url: `https://reddit.com${c.data.permalink}`,
        summary: `👍 ${c.data.score} · ${c.data.num_comments} comments`,
      }));
    },
  },
  {
    id: 'producthunt',
    label: '🚀 Product Hunt (AI)',
    async fetch() {
      // Product Hunt requires OAuth — return placeholder if no token
      const token = process.env.PRODUCT_HUNT_TOKEN;
      if (!token) return [{ title: 'Product Hunt (needs PRODUCT_HUNT_TOKEN)', url: 'https://producthunt.com', summary: 'Set env var to enable' }];
      const res = await timedFetch('https://api.producthunt.com/v2/api/graphql', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: '{ posts(first:3,topic:"artificial-intelligence") { edges { node { name tagline url votesCount } } } }' }),
      });
      return res.data.posts.edges.map(e => ({
        title: e.node.name,
        url: e.node.url,
        summary: `🔼 ${e.node.votesCount} · ${e.node.tagline}`,
      }));
    },
  },
];

// ─── workflow definition ─────────────────────────────────────────────────────

export default defineWorkflow('weekly-ai-digest', async (ctx) => {
  ctx.log('Spawning 6 parallel agents…');

  // Fan-out: all sources run concurrently
  const agentResults = await Promise.all(
    SOURCES.map(src =>
      spawnAgent(ctx, {
        id: src.id,
        task: async () => {
          try {
            return { source: src.label, items: await src.fetch() };
          } catch (err) {
            ctx.log(`⚠️  ${src.id} failed: ${err.message}`);
            return { source: src.label, items: [], error: err.message };
          }
        },
      })
    )
  );

  // Merge + deduplicate by URL
  const seen = new Set();
  const all = agentResults.flatMap(r =>
    r.items
      .filter(item => item.url && !seen.has(item.url) && seen.add(item.url))
      .map(item => ({ ...item, _source: r.source }))
  );

  // Render markdown digest
  const date = new Date().toISOString().split('T')[0];
  const sections = agentResults.map(r => {
    const lines = r.items.map(i => `- [${i.title}](${i.url})\n  _${i.summary}_`).join('\n');
    const err   = r.error ? `\n> ⚠️ Error: ${r.error}` : '';
    return `## ${r.source}${err}\n\n${lines || '_No results_'}`;
  });

  const digest = [
    `# 🤖 Weekly AI Digest — ${date}`,
    `_Generated by \`claude-workflow-starter\` · ${all.length} unique items across ${SOURCES.length} sources_`,
    '',
    ...sections,
    '',
    `---`,
    `_Built with [claude-workflow-starter](https://github.com/RLASAF12/claude-workflow-starter)_`,
  ].join('\n\n');

  ctx.output(digest);
  ctx.log(`✅ Done — ${all.length} items collected.`);
});
