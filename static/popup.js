const DEFAULTS = {
  linkDepth: 4,
  llmContext: true,
  includeAttachments: true,
  includeComments: true,
  saveAs: false,
  contextMenu: true,
  disabledCustomFields: [],
};

const $ = (id) => document.getElementById(id);

const ticketArea = $("ticket-area");
const noTicket = $("no-ticket");
const ticketInfo = $("ticket-info");
const ticketKeyEl = $("ticket-key");
const exportBtn = $("export-btn");
const statusEl = $("status");

const depthInput = $("depth");
const llmToggle = $("llm-mode");
const attachToggle = $("include-attachments");
const commentsToggle = $("include-comments");
const saveAsToggle = $("save-as");
const ctxMenuToggle = $("context-menu");

let detectedKey = null;
let detectedUrl = null;

async function detectTicket() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url) return;
    const m = tab.url.match(/^(https?:\/\/[^/]+)\/browse\/([A-Z][A-Z0-9_]+-\d+)/);
    if (m) {
      detectedKey = m[2];
      detectedUrl = tab.url;
      ticketKeyEl.textContent = detectedKey;
      noTicket.style.display = "none";
      ticketInfo.style.display = "block";
      exportBtn.disabled = false;
      exportBtn.textContent = `Export ${detectedKey}`;
    }
  } catch { }
}

chrome.storage.sync.get(DEFAULTS, (items) => {
  depthInput.value = items.linkDepth;
  llmToggle.checked = items.llmContext;
  attachToggle.checked = items.includeAttachments;
  commentsToggle.checked = items.includeComments;
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
saveAsToggle.addEventListener("change", () => save({ saveAs: saveAsToggle.checked }));
ctxMenuToggle.addEventListener("change", () => save({ contextMenu: ctxMenuToggle.checked }));

exportBtn.addEventListener("click", async () => {
  if (!detectedKey) return;

  exportBtn.disabled = true;
  exportBtn.classList.add("running");
  exportBtn.textContent = "Exporting…";
  statusEl.textContent = "";
  statusEl.className = "status";

  try {
    const response = await chrome.runtime.sendMessage({
      action: "export",
      url: detectedUrl,
    });

    if (response?.error) {
      statusEl.textContent = response.error;
      statusEl.className = "status err";
    } else {
      statusEl.textContent = `${response?.file ?? detectedKey + ".zip"} — ${response?.issueCount ?? "?"} issue(s)`;
      statusEl.className = "status ok";
      renderCustomFields();
    }
  } catch (err) {
    statusEl.textContent = err.message;
    statusEl.className = "status err";
  }

  exportBtn.disabled = false;
  exportBtn.classList.remove("running");
  exportBtn.textContent = `Export ${detectedKey}`;
});

detectTicket();

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
