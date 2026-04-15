const DEFAULTS = {
  linkDepth: 4,
  llmContext: true,
  includeAttachments: true,
  includeComments: true,
  saveAs: false,
  contextMenu: true,
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
