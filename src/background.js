import { fetchAttachment } from "./jira-api.js";
import { crawlLinkedIssues } from "./crawler.js";
import { buildMarkdown } from "./markdown.js";
import { buildZip } from "./zip.js";

const DEFAULT_DEPTH = 4;

const SETTING_DEFAULTS = {
  linkDepth: DEFAULT_DEPTH,
  llmContext: true,
  includeAttachments: true,
  includeComments: true,
  saveAs: false,
  contextMenu: true,
  disabledCustomFields: [],
};

const MENU_ID = "export-jira-ticket";

function createContextMenu() {
  chrome.contextMenus.create({
    id: MENU_ID,
    title: "Export Jira Ticket to ZIP",
    contexts: ["page"],
    documentUrlPatterns: ["*://*.atlassian.net/browse/*"],
  });
}

function removeContextMenu() {
  chrome.contextMenus.remove(MENU_ID, () => chrome.runtime.lastError);
}

chrome.runtime.onInstalled.addListener(async () => {
  const { contextMenu } = await chrome.storage.sync.get({ contextMenu: true });
  if (contextMenu) createContextMenu();
});

// React to setting changes
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
  if (info.menuItemId !== MENU_ID) return;

  try {
    const { issueKey, baseUrl } = parseJiraUrl(tab.url);
    await exportTicket(baseUrl, issueKey);
  } catch (err) {
    console.error("[JiraExporter]", err);
  }
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action !== "export") return;

  const parsed = parseJiraUrl(msg.url);
  exportTicket(parsed.baseUrl, parsed.issueKey)
    .then((result) => sendResponse(result))
    .catch((err) => sendResponse({ error: err.message }));

  return true;
});

function parseJiraUrl(url) {
  const match = url.match(/^(https?:\/\/[^/]+)\/browse\/([A-Z][A-Z0-9_]+-\d+)/);
  if (!match) {
    throw new Error(`Cannot parse Jira issue key from URL: ${url}`);
  }
  return { baseUrl: match[1], issueKey: match[2] };
}

async function getSettings() {
  try {
    return await chrome.storage.sync.get(SETTING_DEFAULTS);
  } catch {
    return { ...SETTING_DEFAULTS };
  }
}

async function exportTicket(baseUrl, issueKey) {
  const settings = await getSettings();
  const { linkDepth: maxDepth, llmContext, includeAttachments, includeComments, saveAs, disabledCustomFields } = settings;
  console.log(`[JiraExporter] Exporting ${issueKey}`, settings);

  const issueMap = await crawlLinkedIssues(baseUrl, issueKey, maxDepth);
  console.log(`[JiraExporter] Fetched ${issueMap.size} issue(s)`);

  const allDiscoveredFields = {};
  const issues = await Promise.all(
    [...issueMap.entries()].map(async ([key, issue]) => {
      let attachments = [];
      if (includeAttachments) {
        const rawAttachments = issue.fields?.attachment ?? [];
        attachments = await Promise.all(
          rawAttachments.map(async (att) => {
            const data = await fetchAttachment(att.content);
            return { name: att.filename, data };
          }),
        );
      }

      const attachFileNames = attachments.map((a) => a.name);
      const { md, discoveredFields } = buildMarkdown(issue, attachFileNames, { includeComments, disabledCustomFields });
      Object.assign(allDiscoveredFields, discoveredFields);

      return { key, md, attachments };
    }),
  );

  if (Object.keys(allDiscoveredFields).length) {
    const { customFieldDefs = {} } = await chrome.storage.local.get({ customFieldDefs: {} });
    await chrome.storage.local.set({ customFieldDefs: { ...customFieldDefs, ...allDiscoveredFields } });
  }

  const index = llmContext ? buildIndex(issueKey, issues, issueMap) : null;

  const base64 = await buildZip(issueKey, issues, index);

  const filename = `${issueKey}.zip`;
  const dataUrl = `data:application/zip;base64,${base64}`;
  chrome.downloads.download(
    { url: dataUrl, filename, saveAs },
  );

  console.log(`[JiraExporter] ${filename} download started (${issues.length} issues).`);
  return { file: filename, issueCount: issues.length };
}

function buildIndex(rootKey, issues, issueMap) {
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
