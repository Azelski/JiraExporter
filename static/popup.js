const DEFAULTS = {
  linkDepth: 4,
  llmContext: true,
  includeAttachments: true,
  includeComments: true,
  includeChildPages: true,
  includeAzureRefs: true,
  saveAs: false,
  contextMenu: true,
  disabledCustomFields: [],
};

const $ = (id) => document.getElementById(id);

const ticketArea = $("ticket-area");
const noTicket = $("no-ticket");
const ticketInfo = $("ticket-info");
const ticketKeyEl = $("ticket-key");
const ticketHintEl = $("ticket-hint");
const exportBtn = $("export-btn");
const statusEl = $("status");

const depthInput = $("depth");
const llmToggle = $("llm-mode");
const attachToggle = $("include-attachments");
const commentsToggle = $("include-comments");
const childPagesToggle = $("include-child-pages");
const azureRefsToggle = $("include-azure-refs");
const saveAsToggle = $("save-as");
const ctxMenuToggle = $("context-menu");

let detectedType = null;
let detectedKey = null;
let detectedUrl = null;

function updateContextUI() {
  if (!detectedType) return;

  document.querySelectorAll("[data-context]").forEach((el) => {
    el.style.display = el.dataset.context === detectedType ? "" : "none";
  });

  const depthLabel = $("depth-label");
  const depthHint = $("depth-hint");
  const commentsHint = $("comments-hint");

  if (detectedType === "jira") {
    depthLabel.textContent = "Link depth";
    depthHint.textContent = "Levels of linked issues to crawl";
    commentsHint.textContent = "Append ticket comments";
  } else if (detectedType === "confluence") {
    depthLabel.textContent = "Child depth";
    depthHint.textContent = "Levels of child pages to crawl";
    commentsHint.textContent = "Append page comments";
  }
}

async function detectPage() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url) return;

    const jiraMatch = tab.url.match(/^(https?:\/\/[^/]+)\/browse\/([A-Z][A-Z0-9_]+-\d+)/);
    const confluenceMatch = tab.url.match(
      /^(https?:\/\/[^/]+)\/wiki\/spaces\/[^/]+\/pages\/(\d+)(?:\/([^?#]*))?/,
    );

    if (jiraMatch) {
      detectedType = "jira";
      detectedKey = jiraMatch[2];
      detectedUrl = tab.url;
      ticketKeyEl.textContent = detectedKey;
      ticketHintEl.textContent = "Jira ticket — ready to export";
      noTicket.style.display = "none";
      ticketInfo.style.display = "block";
      exportBtn.disabled = false;
      exportBtn.textContent = `Export ${detectedKey}`;
    } else if (confluenceMatch) {
      detectedType = "confluence";
      detectedKey = confluenceMatch[2];
      detectedUrl = tab.url;
      const titleSlug = confluenceMatch[3];
      const pageTitle = titleSlug
        ? decodeURIComponent(titleSlug.replace(/\+/g, " ")).replace(/-/g, " ")
        : `Page ${detectedKey}`;
      ticketKeyEl.textContent = pageTitle;
      ticketHintEl.textContent = "Confluence page — ready to export";
      noTicket.style.display = "none";
      ticketInfo.style.display = "block";
      exportBtn.disabled = false;
      exportBtn.textContent = "Export Page";
    }

    updateContextUI();
  } catch { }
}

chrome.storage.sync.get(DEFAULTS, (items) => {
  depthInput.value = items.linkDepth;
  llmToggle.checked = items.llmContext;
  attachToggle.checked = items.includeAttachments;
  commentsToggle.checked = items.includeComments;
  childPagesToggle.checked = items.includeChildPages;
  azureRefsToggle.checked = items.includeAzureRefs;
  saveAsToggle.checked = items.saveAs;
  ctxMenuToggle.checked = items.contextMenu;
});

function save(obj) {
  chrome.storage.sync.set(obj);
}

depthInput.addEventListener("change", () => {
  const v = Math.max(0, Math.min(10, parseInt(depthInput.value, 10) || 0));
  depthInput.value = v;
  save({ linkDepth: v });
});

llmToggle.addEventListener("change", () => save({ llmContext: llmToggle.checked }));
attachToggle.addEventListener("change", () => save({ includeAttachments: attachToggle.checked }));
commentsToggle.addEventListener("change", () => save({ includeComments: commentsToggle.checked }));
childPagesToggle.addEventListener("change", () => save({ includeChildPages: childPagesToggle.checked }));
azureRefsToggle.addEventListener("change", () => save({ includeAzureRefs: azureRefsToggle.checked }));
saveAsToggle.addEventListener("change", () => save({ saveAs: saveAsToggle.checked }));
ctxMenuToggle.addEventListener("change", () => save({ contextMenu: ctxMenuToggle.checked }));

exportBtn.addEventListener("click", async () => {
  if (!detectedKey) return;

  const btnLabel = exportBtn.textContent;
  exportBtn.disabled = true;
  exportBtn.classList.add("running");
  exportBtn.textContent = "Exporting…";
  statusEl.textContent = "";
  statusEl.className = "status";

  try {
    const action = detectedType === "confluence" ? "export-confluence" : "export";
    const response = await chrome.runtime.sendMessage({ action, url: detectedUrl });

    if (response?.error) {
      statusEl.textContent = response.error;
      statusEl.className = "status err";
    } else {
      const count =
        response?.pageCount != null
          ? `${response.pageCount} page(s)`
          : `${response?.issueCount ?? "?"} issue(s)`;
      statusEl.textContent = `${response?.file} — ${count}`;
      statusEl.className = "status ok";
      if (detectedType !== "confluence") renderCustomFields();
    }
  } catch (err) {
    statusEl.textContent = err.message;
    statusEl.className = "status err";
  }

  exportBtn.disabled = false;
  exportBtn.classList.remove("running");
  exportBtn.textContent = btnLabel;
});

detectPage();

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action === "confirm-error") {
    statusEl.textContent = "⚠ Fetch error — check dialog";
    statusEl.className = "status err";
    const shouldContinue = confirm(msg.message);
    sendResponse({ continue: shouldContinue });
    if (!shouldContinue) {
      statusEl.textContent = "Export aborted";
    } else {
      statusEl.textContent = "Continuing…";
      statusEl.className = "status";
    }
    return true;
  }
});

async function renderCustomFields() {
  const { customFieldDefs = {} } = await chrome.storage.local.get({ customFieldDefs: {} });
  const fieldIds = Object.keys(customFieldDefs);

  const list = $("custom-fields-list");

  list.innerHTML = "";

  if (fieldIds.length === 0) {
    const hint = document.createElement("div");
    hint.className = "field-hint";
    hint.style.paddingBottom = "0.5rem";
    hint.textContent = "Run an export to discover available fields.";
    list.appendChild(hint);
    return;
  }

  const { disabledCustomFields = [] } = await chrome.storage.sync.get({ disabledCustomFields: [] });
  const disabled = new Set(disabledCustomFields);

  const sorted = fieldIds.sort((a, b) =>
    customFieldDefs[a].localeCompare(customFieldDefs[b]),
  );

  for (const fieldId of sorted) {
    const name = customFieldDefs[fieldId];

    const div = document.createElement("div");
    div.className = "field";

    const info = document.createElement("div");
    info.className = "field-info";
    const label = document.createElement("div");
    label.className = "field-label";
    label.textContent = name;
    info.appendChild(label);

    const toggleLabel = document.createElement("label");
    toggleLabel.className = "toggle";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.dataset.fieldId = fieldId;
    checkbox.checked = !disabled.has(fieldId);
    checkbox.addEventListener("change", saveDisabledFields);
    const slider = document.createElement("span");
    slider.className = "slider";
    toggleLabel.append(checkbox, slider);

    div.append(info, toggleLabel);
    list.appendChild(div);
  }
}

function saveDisabledFields() {
  const inputs = document.querySelectorAll("#custom-fields-list input[type=checkbox]");
  const disabled = [];
  inputs.forEach((input) => {
    if (!input.checked) disabled.push(input.dataset.fieldId);
  });
  save({ disabledCustomFields: disabled });
}

$("custom-fields-title").addEventListener("click", () => {
  const list = $("custom-fields-list");
  const title = $("custom-fields-title");
  const isOpen = title.classList.contains("open");
  title.classList.toggle("open", !isOpen);
  list.style.display = isOpen ? "none" : "";
  if (!isOpen) renderCustomFields();
});
