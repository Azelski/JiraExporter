const depthInput = document.getElementById("depth");
const llmToggle = document.getElementById("llm-mode");
const attachToggle = document.getElementById("include-attachments");
const commentsToggle = document.getElementById("include-comments");
const childPagesToggle = document.getElementById("include-child-pages");
const azureRefsToggle = document.getElementById("include-azure-refs");
const saveAsToggle = document.getElementById("save-as");
const ctxMenuToggle = document.getElementById("context-menu");
const toast = document.getElementById("toast");

const DEFAULTS = {
  linkDepth: 4,
  llmContext: true,
  includeAttachments: true,
  includeComments: true,
  includeChildPages: true,
  includeAzureRefs: true,
  saveAs: false,
  contextMenu: true,
};

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
  chrome.storage.sync.set(obj, () => {
    toast.classList.add("visible");
    setTimeout(() => toast.classList.remove("visible"), 1200);
  });
}

depthInput.addEventListener("change", () => {
  const value = Math.max(0, Math.min(10, parseInt(depthInput.value, 10) || 0));
  depthInput.value = value;
  save({ linkDepth: value });
});

llmToggle.addEventListener("change", () => save({ llmContext: llmToggle.checked }));
attachToggle.addEventListener("change", () => save({ includeAttachments: attachToggle.checked }));
commentsToggle.addEventListener("change", () => save({ includeComments: commentsToggle.checked }));
childPagesToggle.addEventListener("change", () => save({ includeChildPages: childPagesToggle.checked }));
azureRefsToggle.addEventListener("change", () => save({ includeAzureRefs: azureRefsToggle.checked }));
saveAsToggle.addEventListener("change", () => save({ saveAs: saveAsToggle.checked }));
ctxMenuToggle.addEventListener("change", () => save({ contextMenu: ctxMenuToggle.checked }));
