import { readFile, writeFile } from "node:fs/promises";

const API_ROOT = "https://api.github.com";
const TEMPLATE_PATH = new URL("../README.template.md", import.meta.url);
const OUTPUT_PATH = new URL("../README.md", import.meta.url);

const token = process.env.README_GITHUB_TOKEN || process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";
const repository = process.env.GITHUB_REPOSITORY || "cathaysia/cathaysia";
const repositoryOwner = process.env.GITHUB_REPOSITORY_OWNER || repository.split("/")[0] || "cathaysia";
const targetUser = process.env.README_TARGET_USER || repositoryOwner;

const openLimit = readPositiveInteger("README_OPEN_LIMIT", 20);

const archivedBadge =
  "![archived](https://img.shields.io/badge/archived-6b7280?style=flat-square)";
const selectedWorkHeading = "## Selected Work";
const repositoryLinkPattern =
  /\[([^\]]+)\]\((https:\/\/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+))\)/g;

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

function selectedWorkSection(template) {
  const start = template.indexOf(selectedWorkHeading);

  if (start === -1) {
    return "";
  }

  const end = template.indexOf("\n## ", start + selectedWorkHeading.length);
  return template.slice(start, end === -1 ? template.length : end);
}

function linkedRepositories(section) {
  const repositories = new Set();

  for (const match of section.matchAll(repositoryLinkPattern)) {
    repositories.add(match[3]);
  }

  return [...repositories];
}

async function fetchArchivedRepositories(repositories) {
  const results = await Promise.all(
    repositories.map(async (repository) => {
      const data = await githubFetch(new URL(`/repos/${repository}`, API_ROOT));
      return { repository, archived: data.archived === true };
    })
  );

  return new Set(results.filter((result) => result.archived).map((result) => result.repository));
}

function addArchivedBadges(section, archivedRepositories) {
  return section
    .split(` ${archivedBadge}`)
    .join("")
    .replace(repositoryLinkPattern, (link, _label, _url, repository) =>
      archivedRepositories.has(repository) ? `${link} ${archivedBadge}` : link
    );
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
  const selectedWork = selectedWorkSection(template);
  const archivedRepositories = await fetchArchivedRepositories(linkedRepositories(selectedWork));
  const templateWithBadges = selectedWork
    ? template.replace(selectedWork, () => addArchivedBadges(selectedWork, archivedRepositories))
    : template;
  const output = templateWithBadges
    .replaceAll("{{TRACKED_PULL_REQUESTS}}", formatOpenItems(openPullRequests, "No tracked open pull requests."))
    .replaceAll("{{TRACKED_ISSUES}}", formatOpenItems(openIssues, "No tracked open issues."));

  await writeFile(OUTPUT_PATH, output, "utf8");

  console.log(
    `Rendered README.md for ${targetUser}: ` +
      `${openPullRequests.length} open PRs, ${openIssues.length} open issues, ` +
      `${archivedRepositories.size} archived selected-work repositories.`
  );
}

await main();
