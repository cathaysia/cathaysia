import { readFile, writeFile } from "node:fs/promises";

const API_ROOT = "https://api.github.com";
const TEMPLATE_PATH = new URL("../README.template.md", import.meta.url);
const OUTPUT_PATH = new URL("../README.md", import.meta.url);

const token = process.env.README_GITHUB_TOKEN || process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";
const repository = process.env.GITHUB_REPOSITORY || "cathaysia/cathaysia";
const repositoryOwner = process.env.GITHUB_REPOSITORY_OWNER || repository.split("/")[0] || "cathaysia";
const targetUser = process.env.README_TARGET_USER || repositoryOwner;

const openLimit = readPositiveInteger("README_OPEN_LIMIT", 20);

const openPullRequestQuery =
  process.env.README_OPEN_PR_QUERY || `author:${targetUser} is:pr is:open archived:false`;
const openIssueQuery =
  process.env.README_OPEN_ISSUE_QUERY || `author:${targetUser} is:issue is:open archived:false`;

function readPositiveInteger(name, fallback) {
  const value = Number.parseInt(process.env[name] || "", 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

async function githubFetch(url) {
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "cathaysia-readme-renderer",
    "X-GitHub-Api-Version": "2022-11-28",
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(url, { headers });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub API request failed (${response.status}) for ${url}: ${body}`);
  }

  return response.json();
}

async function searchIssuesAndPullRequests(query, limit) {
  const results = [];
  const perPage = Math.min(100, limit);

  for (let page = 1; results.length < limit; page += 1) {
    const url = new URL("/search/issues", API_ROOT);
    url.searchParams.set("q", query);
    url.searchParams.set("sort", "updated");
    url.searchParams.set("order", "desc");
    url.searchParams.set("per_page", String(perPage));
    url.searchParams.set("page", String(page));

    const data = await githubFetch(url);
    const items = data.items || [];
    results.push(...items);

    if (items.length < perPage) {
      break;
    }
  }

  return results.slice(0, limit);
}

function repositoryName(repositoryUrl) {
  const match = repositoryUrl?.match(/\/repos\/([^/]+\/[^/]+)$/);
  return match ? match[1] : "unknown/repository";
}

function formatDate(value) {
  return new Date(value).toISOString().slice(0, 10);
}

function escapeMarkdown(value) {
  return String(value)
    .replace(/\\/g, "\\\\")
    .replace(/\r?\n/g, " ")
    .replace(/\|/g, "\\|")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]");
}

function formatOpenItems(items, emptyText) {
  if (items.length === 0) {
    return `_${emptyText}_`;
  }

  const rows = items.map((item) => {
    const repo = repositoryName(item.repository_url);
    const title = escapeMarkdown(item.title);
    const itemNumber = `#${item.number}`;
    return `| [${title} ${itemNumber}](${item.html_url}) | [${repo}](https://github.com/${repo}) | ${formatDate(item.updated_at)} |`;
  });

  return ["| Item | Repository | Updated |", "| ---- | ---------- | ------- |", ...rows].join("\n");
}

async function main() {
  const [openPullRequests, openIssues] = await Promise.all([
    searchIssuesAndPullRequests(openPullRequestQuery, openLimit),
    searchIssuesAndPullRequests(openIssueQuery, openLimit),
  ]);

  const template = await readFile(TEMPLATE_PATH, "utf8");
  const output = template
    .replaceAll("{{TRACKED_PULL_REQUESTS}}", formatOpenItems(openPullRequests, "No tracked open pull requests."))
    .replaceAll("{{TRACKED_ISSUES}}", formatOpenItems(openIssues, "No tracked open issues."));

  await writeFile(OUTPUT_PATH, output, "utf8");

  console.log(
    `Rendered README.md for ${targetUser}: ${openPullRequests.length} open PRs, ${openIssues.length} open issues.`
  );
}

await main();
