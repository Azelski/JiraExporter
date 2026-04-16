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

  const issueMap = await crawlJiraLinkedIssues(baseUrl, issueKey, maxDepth);
  console.log(`[JiraExporter] Fetched ${issueMap.size} issue(s)`);

  const allDiscoveredFields = {};
  const issues = await Promise.all(
    [...issueMap.entries()].map(async ([key, issue]) => {
      let attachments = [];
      if (includeAttachments) {
        const rawAttachments = issue.fields?.attachment ?? [];
        attachments = await Promise.all(
          rawAttachments.map(async (att) => {
            const data = await fetchBinaryAttachment(att.content);
            return { name: att.filename, data };
          }),
        );
      }

      const attachFileNames = attachments.map((a) => a.name);
      let { md, discoveredFields } = buildJiraIssueMarkdown(issue, attachFileNames, { includeComments, disabledCustomFields });
      Object.assign(allDiscoveredFields, discoveredFields);

      if (includeAzureRefs) {
        const rendered = issue.renderedFields ?? {};
        const rawHtmlSources = [
          rendered.description ?? issue.fields?.description ?? "",
          ...(rendered.comment?.comments?.map((c) => c.body) ?? []),
          ...Object.values(rendered).filter((v) => typeof v === "string"),
        ];
        const azureRefs = await resolveAzureDevOpsRefs(md, ...rawHtmlSources);
        const azureSection = buildAzureRefsMarkdownSection(azureRefs);
        if (azureSection) md += "\n" + azureSection;
      }

      return { key, md, attachments };
    }),
  );

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
  const page = await fetchConfluencePage(baseUrl, pageId);
  visited.set(pageId, page);

  if (depth >= maxDepth) return;

  const childIds = (page.children?.page?.results ?? []).map((c) => c.id);
  await Promise.all(
    childIds.map((id) => crawlPage(baseUrl, id, depth + 1, maxDepth, visited)),
  );
}

async function exportConfluencePages(baseUrl, pageId) {
  const settings = await getSettings();
  const { linkDepth: maxDepth, llmContext, includeAttachments, includeComments, includeAzureRefs, saveAs } = settings;
  console.log(`[JiraExporter] Exporting Confluence page ${pageId}`, settings);

  const pageMap = await crawlConfluencePages(baseUrl, pageId, maxDepth);
  console.log(`[JiraExporter] Fetched ${pageMap.size} Confluence page(s)`);

  const pages = await Promise.all(
    [...pageMap.entries()].map(async ([id, page]) => {
      let attachments = [];
      if (includeAttachments) {
        const rawAttachments = await fetchConfluencePageAttachments(baseUrl, id);
        const resolved = await Promise.all(
          rawAttachments.map(async (att) => {
            const downloadPath = att._links?.download;
            if (!downloadPath) return null;
            const prefix = downloadPath.startsWith("/wiki") ? "" : "/wiki";
            const downloadUrl = `${baseUrl}${prefix}${downloadPath}`;
            const data = await fetchBinaryAttachment(downloadUrl);
            return { name: att.title, data };
          }),
        );
        attachments = resolved.filter(Boolean);
      }

      let comments = [];
      if (includeComments) {
        comments = await fetchConfluenceComments(baseUrl, id);
      }

      const attachFileNames = attachments.map((a) => a.name);
      let md = buildConfluencePageMarkdown(page, comments, attachFileNames, { includeComments });

      if (includeAzureRefs) {
        const rawHtmlSources = [
          page.body?.view?.value ?? "",
          ...comments.map((c) => c.body?.view?.value ?? ""),
        ];
        const azureRefs = await resolveAzureDevOpsRefs(md, ...rawHtmlSources);
        const azureSection = buildAzureRefsMarkdownSection(azureRefs);
        if (azureSection) md += "\n" + azureSection;
      }

      return { key: id, md, attachments };
    }),
  );

  const rootPage = pageMap.get(pageId);
  const rootTitle = sanitizeFilename(rootPage?.title ?? pageId);
  const index = llmContext ? buildConfluenceExportIndex(pageId, rootTitle, pages, pageMap) : null;

  const base64 = await buildExportZip(rootTitle, pages, index);
  const filename = `${rootTitle}.zip`;
  const dataUrl = `data:application/zip;base64,${base64}`;
  chrome.downloads.download({ url: dataUrl, filename, saveAs });

  console.log(`[JiraExporter] ${filename} download started (${pages.length} pages).`);
  return { file: filename, pageCount: pages.length };
}

function buildConfluenceExportIndex(rootId, rootTitle, pages, pageMap) {
  const lines = [];

  lines.push(`# ${rootTitle} — Export Index`);
  lines.push("");
  lines.push("This archive was exported from Confluence for LLM context.");
  lines.push("");
  lines.push("## Main Page");
  lines.push("");
  lines.push(`- [${rootTitle}](./${rootId}/${rootId}.md)`);
  lines.push("");

  const others = pages.filter((p) => p.key !== rootId);
  if (others.length) {
    lines.push(`## Child Pages (${others.length})`);
    lines.push("");
    for (const { key } of others) {
      const page = pageMap.get(key);
      const title = page?.title ?? key;
      const space = page?.space?.key ?? "";
      lines.push(`- [${key}](./${key}/${key}.md) — ${title}${space ? ` (${space})` : ""}`);
    }
    lines.push("");
  }

  lines.push("## How to read this");
  lines.push("");
  lines.push(`Start with the main page above. Each page file has a "Child Pages" section with relative links to child pages in this archive. Attachments for each page sit in its own \`attachments/\` subfolder.`);

  return lines.join("\n");
}
