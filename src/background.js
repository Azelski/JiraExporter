import { fetchBinaryAttachment, fetchConfluencePage, fetchConfluencePageAttachments, fetchConfluenceComments } from "./jira-api.js";
import { crawlJiraLinkedIssues } from "./crawler.js";
import { buildJiraIssueMarkdown, buildConfluencePageMarkdown } from "./markdown.js";
import { buildExportZip } from "./zip.js";
import { resolveAzureDevOpsRefs, buildAzureRefsMarkdownSection } from "./azure-devops.js";

const DEFAULT_DEPTH = 4;

const SETTING_DEFAULTS = {
  linkDepth: DEFAULT_DEPTH,
  llmContext: true,
  includeAttachments: true,
  includeComments: true,
  includeChildPages: true,
  includeAzureRefs: true,
  saveAs: false,
  contextMenu: true,
  disabledCustomFields: [],
};

const MENU_ID = "export-jira-ticket";
const CONFLUENCE_MENU_ID = "export-confluence-page";

function createContextMenu() {
  chrome.contextMenus.create({
    id: MENU_ID,
    title: "Export Jira Ticket to ZIP",
    contexts: ["page"],
    documentUrlPatterns: ["*://*.atlassian.net/browse/*"],
  });
  chrome.contextMenus.create({
    id: CONFLUENCE_MENU_ID,
    title: "Export Confluence Page to ZIP",
    contexts: ["page"],
    documentUrlPatterns: ["*://*.atlassian.net/wiki/spaces/*/pages/*"],
  });
}

function removeContextMenu() {
  chrome.contextMenus.remove(MENU_ID, () => chrome.runtime.lastError);
  chrome.contextMenus.remove(CONFLUENCE_MENU_ID, () => chrome.runtime.lastError);
}

chrome.runtime.onInstalled.addListener(async () => {
  const { contextMenu } = await chrome.storage.sync.get({ contextMenu: true });
  if (contextMenu) createContextMenu();
});

chrome.storage.onChanged.addListener((changes) => {
  if (changes.contextMenu) {
    if (changes.contextMenu.newValue) {
      createContextMenu();
    } else {
      removeContextMenu();
    }
  }
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === MENU_ID) {
    try {
      const { issueKey, baseUrl } = parseJiraUrl(tab.url);
      await exportJiraIssue(baseUrl, issueKey);
    } catch (err) {
      console.error("[JiraExporter]", err);
    }
  } else if (info.menuItemId === CONFLUENCE_MENU_ID) {
    try {
      const { pageId, baseUrl } = parseConfluenceUrl(tab.url);
      await exportConfluencePages(baseUrl, pageId);
    } catch (err) {
      console.error("[JiraExporter]", err);
    }
  }
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action === "export") {
    const parsed = parseJiraUrl(msg.url);
    exportJiraIssue(parsed.baseUrl, parsed.issueKey)
      .then((result) => sendResponse(result))
      .catch((err) => sendResponse({ error: err.message }));
    return true;
  }

  if (msg.action === "export-confluence") {
    const parsed = parseConfluenceUrl(msg.url);
    exportConfluencePages(parsed.baseUrl, parsed.pageId)
      .then((result) => sendResponse(result))
      .catch((err) => sendResponse({ error: err.message }));
    return true;
  }
});

function parseJiraUrl(url) {
  const match = url.match(/^(https?:\/\/[^/]+)\/browse\/([A-Z][A-Z0-9_]+-\d+)/);
  if (!match) {
    throw new Error(`Cannot parse Jira issue key from URL: ${url}`);
  }
  return { baseUrl: match[1], issueKey: match[2] };
}

function parseConfluenceUrl(url) {
  const match = url.match(/^(https?:\/\/[^/]+)\/wiki\/spaces\/[^/]+\/pages\/(\d+)/);
  if (!match) {
    throw new Error(`Cannot parse Confluence page ID from URL: ${url}`);
  }
  return { baseUrl: match[1], pageId: match[2] };
}

function sanitizeFilename(name) {
  return name.replace(/[/\\:*?"<>|]/g, "_").trim().substring(0, 100);
}

async function askUserToContinue(errorMsg) {
  try {
    const response = await chrome.runtime.sendMessage({
      action: "confirm-error",
      message: errorMsg,
    });
    return response?.continue ?? false;
  } catch {
    return false;
  }
}

class ExportAbortedError extends Error {
  constructor() { super("Export aborted by user"); }
}

async function skipOrAbort(errorMsg) {
  const skip = await askUserToContinue(errorMsg);
  if (!skip) throw new ExportAbortedError();
}

async function getSettings() {
  try {
    return await chrome.storage.sync.get(SETTING_DEFAULTS);
  } catch {
    return { ...SETTING_DEFAULTS };
  }
}

async function exportJiraIssue(baseUrl, issueKey) {
  const settings = await getSettings();
  const { linkDepth: maxDepth, llmContext, includeAttachments, includeComments, includeAzureRefs, saveAs, disabledCustomFields } = settings;
  console.log(`[JiraExporter] Exporting ${issueKey}`, settings);

  const issueMap = await crawlJiraLinkedIssues(baseUrl, issueKey, maxDepth, skipOrAbort);
  console.log(`[JiraExporter] Fetched ${issueMap.size} issue(s)`);

  const allDiscoveredFields = {};
  const issues = [];
  for (const [key, issue] of issueMap) {
    let attachments = [];
    if (includeAttachments) {
      const rawAttachments = issue.fields?.attachment ?? [];
      for (const att of rawAttachments) {
        try {
          const data = await fetchBinaryAttachment(att.content);
          attachments.push({ name: att.filename, data });
        } catch (err) {
          await skipOrAbort(`Attachment "${att.filename}" failed: ${err.message}\n\nSkip and continue?`);
        }
      }
    }

    const attachFileNames = attachments.map((a) => a.name);
    let { md, discoveredFields } = buildJiraIssueMarkdown(issue, attachFileNames, { includeComments, disabledCustomFields });
    Object.assign(allDiscoveredFields, discoveredFields);

    if (includeAzureRefs) {
      try {
        const rendered = issue.renderedFields ?? {};
        const rawHtmlSources = [
          rendered.description ?? issue.fields?.description ?? "",
          ...(rendered.comment?.comments?.map((c) => c.body) ?? []),
          ...Object.values(rendered).filter((v) => typeof v === "string"),
        ];
        const azureRefs = await resolveAzureDevOpsRefs(md, ...rawHtmlSources);
        const azureSection = buildAzureRefsMarkdownSection(azureRefs);
        if (azureSection) md += "\n" + azureSection;
      } catch (err) {
        await skipOrAbort(`Azure DevOps refs for ${key} failed: ${err.message}\n\nSkip and continue?`);
      }
    }

    issues.push({ key, md, attachments });
  }

  if (Object.keys(allDiscoveredFields).length) {
    const { customFieldDefs = {} } = await chrome.storage.local.get({ customFieldDefs: {} });
    await chrome.storage.local.set({ customFieldDefs: { ...customFieldDefs, ...allDiscoveredFields } });
  }

  const index = llmContext ? buildJiraExportIndex(issueKey, issues, issueMap) : null;

  const base64 = await buildExportZip(issueKey, issues, index);

  const filename = `${issueKey}.zip`;
  const dataUrl = `data:application/zip;base64,${base64}`;
  chrome.downloads.download(
    { url: dataUrl, filename, saveAs },
  );

  console.log(`[JiraExporter] ${filename} download started (${issues.length} issues).`);
  return { file: filename, issueCount: issues.length };
}

function buildJiraExportIndex(rootKey, issues, issueMap) {
  const root = issueMap.get(rootKey);
  const lines = [];

  lines.push(`# ${rootKey} — Export Index`);
  lines.push("");
  lines.push("This archive was exported from Jira for LLM context.");
  lines.push("");
  lines.push(`## Main Issue`);
  lines.push("");
  lines.push(`- [${rootKey}: ${root?.fields?.summary ?? ""}](./${rootKey}/${rootKey}.md)`);
  lines.push("");

  const others = issues.filter((i) => i.key !== rootKey);
  if (others.length) {
    lines.push(`## Related Issues (${others.length})`);
    lines.push("");
    for (const { key } of others) {
      const issue = issueMap.get(key);
      const summary = issue?.fields?.summary ?? "";
      const type = issue?.fields?.issuetype?.name ?? "";
      const status = issue?.fields?.status?.name ?? "";
      lines.push(`- [${key}](./${key}/${key}.md) — ${type} / ${status} — ${summary}`);
    }
    lines.push("");
  }

  lines.push("## How to read this");
  lines.push("");
  lines.push(`Start with the main issue above. Each issue file has a "Linked Issues" section with relative links to related tickets in this archive. Attachments for each issue sit in its own \`attachments/\` subfolder.`);

  return lines.join("\n");
}

async function crawlConfluencePages(baseUrl, pageId, maxDepth) {
  const visited = new Map();
  await crawlPage(baseUrl, pageId, 0, maxDepth, visited);
  return visited;
}

async function crawlPage(baseUrl, pageId, depth, maxDepth, visited) {
  if (visited.has(pageId)) return;

  console.log(`[JiraExporter] Fetching Confluence page ${pageId} (depth ${depth}/${maxDepth})`);
  let page;
  try {
    page = await fetchConfluencePage(baseUrl, pageId);
  } catch (err) {
    let skip = await askUserToContinue(`Failed to fetch page ${pageId}: ${err.message}\n\nSkip and continue?`);
    if (skip) return;
    throw new ExportAbortedError();
  }
  visited.set(pageId, page);

  if (depth >= maxDepth) return;

  const childIds = (page.children?.page?.results ?? []).map((c) => c.id);
  await Promise.all(
    childIds.map((id) => crawlPage(baseUrl, id, depth + 1, maxDepth, visited)),
  );
}

async function exportConfluencePages(baseUrl, pageId) {
  const settings = await getSettings();
  const { linkDepth: maxDepth, llmContext, includeAttachments, includeComments, includeChildPages, includeAzureRefs, saveAs } = settings;
  console.log(`[JiraExporter] Exporting Confluence page ${pageId}`, settings);

  const childDepth = includeChildPages ? maxDepth : 0;
  const pageMap = await crawlConfluencePages(baseUrl, pageId, childDepth);
  console.log(`[JiraExporter] Fetched ${pageMap.size} Confluence page(s)`);

  const slugMap = buildConfluenceSlugMap(pageMap);

  const pages = [];
  for (const [id, page] of pageMap) {
    let attachments = [];
    if (includeAttachments) {
      try {
        const rawAttachments = await fetchConfluencePageAttachments(baseUrl, id);
        for (const att of rawAttachments) {
          try {
            const downloadPath = att._links?.download;
            if (!downloadPath) continue;
            const prefix = downloadPath.startsWith("/wiki") ? "" : "/wiki";
            const downloadUrl = `${baseUrl}${prefix}${downloadPath}`;
            const data = await fetchBinaryAttachment(downloadUrl);
            attachments.push({ name: att.title, data });
          } catch (err) {
            await skipOrAbort(`Attachment "${att.title}" failed: ${err.message}\n\nSkip and continue?`);
          }
        }
      } catch (err) {
        if (err instanceof ExportAbortedError) throw err;
        await skipOrAbort(`Fetching attachments for page failed: ${err.message}\n\nSkip and continue?`);
      }
    }

    let comments = [];
    if (includeComments) {
      try {
        comments = await fetchConfluenceComments(baseUrl, id);
      } catch (err) {
        await skipOrAbort(`Comments for page failed: ${err.message}\n\nSkip and continue?`);
      }
    }

    const attachFileNames = attachments.map((a) => a.name);
    let md = buildConfluencePageMarkdown(page, comments, attachFileNames, { includeComments, slugMap });

    if (includeAzureRefs) {
      try {
        const rawHtmlSources = [
          page.body?.view?.value ?? "",
          ...comments.map((c) => c.body?.view?.value ?? ""),
        ];
        const azureRefs = await resolveAzureDevOpsRefs(md, ...rawHtmlSources);
        const azureSection = buildAzureRefsMarkdownSection(azureRefs);
        if (azureSection) md += "\n" + azureSection;
      } catch (err) {
        if (err instanceof ExportAbortedError) throw err;
        await skipOrAbort(`Azure DevOps refs failed: ${err.message}\n\nSkip and continue?`);
      }
    }

    pages.push({ key: slugMap[id], md, attachments });
  }

  const rootPage = pageMap.get(pageId);
  const rootSlug = slugMap[pageId];
  const index = llmContext ? buildConfluenceExportIndex(rootSlug, pages, pageMap, slugMap) : null;

  const base64 = await buildExportZip(rootSlug, pages, index);
  const filename = `${rootSlug}.zip`;
  const dataUrl = `data:application/zip;base64,${base64}`;
  chrome.downloads.download({ url: dataUrl, filename, saveAs });

  console.log(`[JiraExporter] ${filename} download started (${pages.length} pages).`);
  return { file: filename, pageCount: pages.length };
}

function buildConfluenceSlugMap(pageMap) {
  const slugs = {};
  const usedSlugs = new Set();

  for (const [id, page] of pageMap) {
    let slug = sanitizeFilename(page.title ?? id);
    if (!slug) slug = String(id);

    let unique = slug;
    let counter = 2;
    while (usedSlugs.has(unique)) {
      unique = `${slug}-${counter++}`;
    }
    usedSlugs.add(unique);
    slugs[id] = unique;
  }

  return slugs;
}

function buildConfluenceExportIndex(rootSlug, pages, pageMap, slugMap) {
  const lines = [];

  lines.push(`# ${rootSlug} — Export Index`);
  lines.push("");
  lines.push("This archive was exported from Confluence for LLM context.");
  lines.push("");
  lines.push("## Main Page");
  lines.push("");
  lines.push(`- [${rootSlug}](./${rootSlug}/${rootSlug}.md)`);
  lines.push("");

  const others = pages.filter((p) => p.key !== rootSlug);
  if (others.length) {
    lines.push(`## Child Pages (${others.length})`);
    lines.push("");
    for (const { key } of others) {
      const id = Object.keys(slugMap).find((k) => slugMap[k] === key);
      const page = id ? pageMap.get(id) : null;
      const title = page?.title ?? key;
      const space = page?.space?.key ?? "";
      lines.push(`- [${title}](./${key}/${key}.md)${space ? ` (${space})` : ""}`);
    }
    lines.push("");
  }

  lines.push("## How to read this");
  lines.push("");
  lines.push(`Start with the main page above. Each page file has a "Child Pages" section with relative links to child pages in this archive. Attachments for each page sit in its own \`attachments/\` subfolder.`);

  return lines.join("\n");
}
