# claude-workflow-starter

> **Minimal working example of Claude Code Dynamic Workflows** — fan-out parallel agents that collect, merge, and output a weekly AI news digest.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node >=18](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](package.json)
[![Claude Code Workflows](https://img.shields.io/badge/Claude_Code-Workflows-blueviolet)](https://code.claude.com/docs/en/workflows)

---

## What is this?

[Claude Code Dynamic Workflows](https://code.claude.com/docs/en/workflows) (announced June 2, 2026) lets you write a `.js` orchestration script that Claude Code executes in the background — spawning up to **1,000 parallel subagents** while your session stays responsive.

This repo is the **clone-and-run starter the official docs forgot to ship.**

The example workflow:
- Spawns **6 agents in parallel**, each fetching a different AI news source
- Merges and deduplicates ~18 items
- Outputs a clean **markdown digest**

---

## File tree

```
claude-workflow-starter/
├── workflow.js        <- the workflow (this is the whole thing)
├── package.json
├── .env.example
└── README.md
```

---

## Quick start

```bash
git clone https://github.com/RLASAF12/claude-workflow-starter
cd claude-workflow-starter

# Optional: enable Product Hunt section
cp .env.example .env
# edit .env: add PRODUCT_HUNT_TOKEN

# Trigger via Claude Code (include the word "workflow")
claude "Run the weekly-ai-digest workflow"
```

Claude Code detects the word *workflow*, loads `workflow.js`, and executes it.

---

## How the fan-out pattern works

```
                    +------------------+
                    |  defineWorkflow   |
                    +--------+---------+
                             | Promise.all()
          +------------------+------------------+
          |          |       |       |           |
    HN Agent   GitHub   arXiv  Dev.to  Reddit  PH
    Agent      Agent    Agent   Agent  Agent   Agent
          |          |       |       |           |
          +------------------+------------------+
                             | merge + deduplicate
                    +--------v---------+
                    |  markdown digest  |
                    +------------------+
```

6 agents run **concurrently**. Each has a 10s timeout. Failures are caught per-agent — one broken source does not kill the digest.

---

## Sources covered

| Agent | Source | API |
|-------|--------|-----|
| hackernews | HN Top Stories | Firebase REST (public) |
| github | GitHub Trending AI | GitHub Search API (public) |
| arxiv | cs.AI papers | arXiv Export API (public) |
| devto | dev.to / ai tag | Dev.to API (public) |
| reddit | r/MachineLearning | Reddit JSON API (public) |
| producthunt | PH AI launches | PH API (needs token) |

---

## Add your own source in 10 lines

```js
SOURCES.push({
  id: 'my-source',
  label: 'My Source',
  async fetch() {
    const data = await timedFetch('https://api.example.com/items');
    return data.items.slice(0, 3).map(item => ({
      title:   item.name,
      url:     item.link,
      summary: item.description.slice(0, 100),
    }));
  },
});
```

---

## Known limitations

- Requires @anthropic-ai/claude-code-workflows peer dependency (ships with Claude Code >= June 2026 release)
- Product Hunt section disabled by default (needs OAuth token)
- arXiv parser uses regex -- robust enough for prototyping, not for production
- No caching between runs

---

## Related

- [claude-agent-sdk-starter](https://github.com/RLASAF12/claude-agent-sdk-starter) -- TypeScript starter for the Anthropic Agent SDK (API-level)
- [mcp-gateway-starter](https://github.com/RLASAF12/mcp-gateway-starter) -- Minimal MCP HTTP server template
- [Official Workflows docs](https://code.claude.com/docs/en/workflows)

---

Built with claude-workflow-starter | MIT License
