import { fetchIssue } from "./jira-api.js";

export async function crawlLinkedIssues(baseUrl, rootKey, maxDepth) {
  const visited = new Map();
  await crawl(baseUrl, rootKey, 0, maxDepth, visited);
  return visited;
}

async function crawl(baseUrl, issueKey, depth, maxDepth, visited) {
  if (visited.has(issueKey)) return;

  console.log(`[JiraExporter] Fetching ${issueKey} (depth ${depth}/${maxDepth})`);
  const issue = await fetchIssue(baseUrl, issueKey);
  visited.set(issueKey, issue);

  if (depth >= maxDepth) return;

  const linkedKeys = extractLinkedKeys(issue);

  if (issue.fields?.subtasks) {
    for (const sub of issue.fields.subtasks) {
      linkedKeys.add(sub.key);
    }
  }
  if (issue.fields?.parent?.key) {
    linkedKeys.add(issue.fields.parent.key);
  }

  await Promise.all(
    [...linkedKeys].map((key) => crawl(baseUrl, key, depth + 1, maxDepth, visited)),
  );
}

function extractLinkedKeys(issue) {
  const keys = new Set();
  const links = issue.fields?.issuelinks ?? [];

  for (const link of links) {
    if (link.outwardIssue?.key) keys.add(link.outwardIssue.key);
    if (link.inwardIssue?.key) keys.add(link.inwardIssue.key);
  }

  return keys;
}
