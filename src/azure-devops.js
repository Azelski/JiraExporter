const AZURE_URL_RE = /https:\/\/dev\.azure\.com\/[^\s)>\]"'&]+/g;

const PR_RE =
  /^https:\/\/dev\.azure\.com\/([^/]+)\/([^/]+)\/_git\/([^/]+)\/pullrequest\/(\d+)/;

const FILE_RE =
  /^https:\/\/dev\.azure\.com\/([^/]+)\/([^/]+)\/_git\/([^/]+)\?.*path=([^&]+)/;

const COMMIT_RE =
  /^https:\/\/dev\.azure\.com\/([^/]+)\/([^/]+)\/_git\/([^/]+)\/commit\/([0-9a-f]+)/;

export async function resolveAzureDevOpsRefs(...sources) {
  const allUrls = new Set();
  for (const text of sources) {
    const matches = text?.match(AZURE_URL_RE) ?? [];
    for (const m of matches) allUrls.add(m);
  }
  if (!allUrls.size) return [];

  const results = [];

  for (const url of allUrls) {
    try {
      const resolved = await resolveUrl(url);
      if (resolved) results.push(resolved);
    } catch (err) {
      console.warn(`[JiraExporter] Failed to resolve Azure DevOps URL: ${url}`, err);
      results.push({ url, label: url, content: `> Failed to fetch: ${err.message}` });
    }
  }

  return results;
}

async function resolveUrl(url) {
  let m;

  if ((m = url.match(PR_RE))) {
    return resolvePullRequest(url, m[1], m[2], m[3], m[4]);
  }
  if ((m = url.match(COMMIT_RE))) {
    return resolveCommit(url, m[1], m[2], m[3], m[4]);
  }
  if ((m = url.match(FILE_RE))) {
    return resolveFile(url, m[1], m[2], m[3], decodeURIComponent(m[4]));
  }

  return null;
}

async function azureFetch(url) {
  const res = await fetch(url, {
    credentials: "include",
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText}`);
  }
  return res.json();
}

async function azureFetchText(url) {
  const res = await fetch(url, {
    credentials: "include",
    headers: { Accept: "text/plain" },
  });
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText}`);
  }
  return res.text();
}

async function resolvePullRequest(originalUrl, org, project, repo, prId) {
  const apiBase = `https://dev.azure.com/${enc(org)}/${enc(project)}/_apis/git/repositories/${enc(repo)}`;

  const pr = await azureFetch(`${apiBase}/pullrequests/${enc(prId)}?api-version=7.1`);

  const lines = [];
  lines.push(`## Pull Request #${prId}: ${pr.title ?? ""}`);
  lines.push("");
  lines.push(`| Field | Value |`);
  lines.push(`|-------|-------|`);
  lines.push(`| **Status** | ${pr.status ?? "–"} |`);
  lines.push(`| **Created by** | ${pr.createdBy?.displayName ?? "–"} |`);
  lines.push(`| **Created** | ${pr.creationDate ?? "–"} |`);
  lines.push(`| **Source branch** | ${pr.sourceRefName ?? "–"} |`);
  lines.push(`| **Target branch** | ${pr.targetRefName ?? "–"} |`);
  if (pr.mergeStatus) lines.push(`| **Merge status** | ${pr.mergeStatus} |`);
  lines.push("");

  if (pr.description) {
    lines.push("### Description");
    lines.push("");
    lines.push(pr.description);
    lines.push("");
  }

  try {
    const iterations = await azureFetch(
      `${apiBase}/pullrequests/${enc(prId)}/iterations?api-version=7.1`,
    );
    const lastIteration = iterations.value?.[iterations.value.length - 1];
    if (lastIteration) {
      const changes = await azureFetch(
        `${apiBase}/pullrequests/${enc(prId)}/iterations/${lastIteration.id}/changes?api-version=7.1`,
      );
      const changedFiles = changes.changeEntries ?? [];
      if (changedFiles.length) {
        lines.push("### Changed Files");
        lines.push("");
        for (const entry of changedFiles) {
          const changeType = entry.changeType ?? "edit";
          const path = entry.item?.path ?? entry.item?.originalPath ?? "?";
          lines.push(`- \`${changeType}\` ${path}`);
        }
        lines.push("");
      }
    }
  } catch {
  }

  try {
    const threads = await azureFetch(
      `${apiBase}/pullrequests/${enc(prId)}/threads?api-version=7.1`,
    );
    const meaningful = (threads.value ?? []).filter(
      (t) => t.comments?.some((c) => c.commentType !== "system") && !t.isDeleted,
    );
    if (meaningful.length) {
      lines.push("### Review Comments");
      lines.push("");
      for (const thread of meaningful.slice(0, 50)) {
        const ctx = thread.threadContext;
        const statusTag = thread.status && thread.status !== "unknown" ? ` [${thread.status}]` : "";
        if (ctx?.filePath) {
          lines.push(`**${ctx.filePath}** (line ${ctx.rightFileStart?.line ?? "?"})${statusTag}`);
          lines.push("");
        } else if (statusTag) {
          lines.push(`**General comment**${statusTag}`);
          lines.push("");
        }
        for (const c of thread.comments) {
          if (c.commentType === "system") continue;
          const author = c.author?.displayName ?? "Unknown";
          lines.push(`> **${author}:** ${(c.content ?? "").trim()}`);
          lines.push("");
        }
      }
    }
  } catch {
  }

  return { url: originalUrl, label: `PR #${prId}: ${pr.title ?? ""}`, content: lines.join("\n") };
}

async function resolveCommit(originalUrl, org, project, repo, sha) {
  const apiBase = `https://dev.azure.com/${enc(org)}/${enc(project)}/_apis/git/repositories/${enc(repo)}`;

  const commit = await azureFetch(`${apiBase}/commits/${enc(sha)}?api-version=7.1`);

  const lines = [];
  lines.push(`## Commit ${sha.substring(0, 8)}`);
  lines.push("");
  lines.push(`| Field | Value |`);
  lines.push(`|-------|-------|`);
  lines.push(`| **Author** | ${commit.author?.name ?? "–"} |`);
  lines.push(`| **Date** | ${commit.author?.date ?? "–"} |`);
  lines.push(`| **SHA** | \`${sha}\` |`);
  lines.push("");
  lines.push("### Message");
  lines.push("");
  lines.push(commit.comment ?? "");
  lines.push("");

  try {
    const changes = await azureFetch(`${apiBase}/commits/${enc(sha)}/changes?api-version=7.1`);
    const items = changes.changes ?? [];
    if (items.length) {
      lines.push("### Changed Files");
      lines.push("");
      for (const ch of items) {
        const changeType = ch.changeType ?? "edit";
        const path = ch.item?.path ?? "?";
        lines.push(`- \`${changeType}\` ${path}`);
      }
      lines.push("");
    }
  } catch {
  }

  return { url: originalUrl, label: `Commit ${sha.substring(0, 8)}`, content: lines.join("\n") };
}

async function resolveFile(originalUrl, org, project, repo, filePath) {
  const apiBase = `https://dev.azure.com/${enc(org)}/${enc(project)}/_apis/git/repositories/${enc(repo)}`;

  const versionMatch = originalUrl.match(/[&?]version=GB([^&]+)/);
  const versionParam = versionMatch
    ? `&versionDescriptor.version=${enc(decodeURIComponent(versionMatch[1]))}&versionDescriptor.versionType=branch`
    : "";

  const itemUrl = `${apiBase}/items?path=${enc(filePath)}${versionParam}&includeContent=true&api-version=7.1`;

  let content;
  try {
    content = await azureFetchText(
      `${apiBase}/items?path=${enc(filePath)}${versionParam}&api-version=7.1`,
    );
  } catch {
    const item = await azureFetch(itemUrl);
    content = item.content ?? "(binary file)";
  }

  const ext = filePath.split(".").pop() ?? "";
  const MAX_CHARS = 50_000;
  const truncated = content.length > MAX_CHARS
    ? content.substring(0, MAX_CHARS) + "\n\n… (truncated)"
    : content;

  const lines = [];
  lines.push(`## File: ${filePath}`);
  lines.push("");
  lines.push("```" + ext);
  lines.push(truncated);
  lines.push("```");
  lines.push("");

  return { url: originalUrl, label: `File: ${filePath}`, content: lines.join("\n") };
}

function enc(s) {
  return encodeURIComponent(s);
}

export function buildAzureRefsMarkdownSection(refs) {
  if (!refs.length) return "";

  const lines = [];
  lines.push("## Azure DevOps References");
  lines.push("");

  for (const ref of refs) {
    lines.push(ref.content);
    lines.push(`> Source: ${ref.url}`);
    lines.push("");
    lines.push("---");
    lines.push("");
  }

  return lines.join("\n");
}
