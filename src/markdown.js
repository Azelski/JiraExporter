import { NodeHtmlMarkdown } from "node-html-markdown";

const nhm = new NodeHtmlMarkdown({ codeBlockStyle: "fenced" });

export function htmlToMarkdown(html) {
  if (!html) return "";
  return nhm.translate(html);
}

export function buildMarkdown(issue, attachFiles, opts = {}) {
  const { includeComments = true, disabledCustomFields = [] } = opts;
  const fields = issue.fields;
  const rendered = issue.renderedFields ?? {};
  const key = issue.key;

  const lines = [];

  lines.push(`# ${key}: ${fields.summary ?? "(no summary)"}`);
  lines.push("");
  lines.push(`| Field | Value |`);
  lines.push(`|-------|-------|`);
  lines.push(`| **Status** | ${fields.status?.name ?? "–"} |`);
  lines.push(`| **Type** | ${fields.issuetype?.name ?? "–"} |`);
  lines.push(`| **Priority** | ${fields.priority?.name ?? "–"} |`);
  lines.push(`| **Assignee** | ${fields.assignee?.displayName ?? "Unassigned"} |`);
  lines.push(`| **Reporter** | ${fields.reporter?.displayName ?? "–"} |`);
  lines.push(`| **Created** | ${fields.created ?? "–"} |`);
  lines.push(`| **Updated** | ${fields.updated ?? "–"} |`);
  if (fields.labels?.length) {
    lines.push(`| **Labels** | ${fields.labels.join(", ")} |`);
  }
  lines.push("");

  lines.push("## Description");
  lines.push("");
  const descHtml = rendered.description ?? fields.description ?? "";
  lines.push(htmlToMarkdown(descHtml));
  lines.push("");

  const comments = fields.comment?.comments ?? [];
  if (includeComments && comments.length) {
    lines.push("## Comments");
    lines.push("");
    for (const c of comments) {
      const author = c.author?.displayName ?? "Unknown";
      const date = c.created ?? "";
      const bodyHtml =
        rendered.comment?.comments?.find((rc) => rc.id === c.id)?.body ??
        c.renderedBody ??
        c.body ??
        "";
      lines.push(`### ${author} — ${date}`);
      lines.push("");
      lines.push(htmlToMarkdown(bodyHtml));
      lines.push("");
    }
  }

  const issueLinks = fields.issuelinks ?? [];
  const subtasks = fields.subtasks ?? [];
  const parent = fields.parent;

  if (issueLinks.length || subtasks.length || parent) {
    lines.push("## Linked Issues");
    lines.push("");

    if (parent) {
      lines.push(`- **Parent:** [${parent.key}](../${parent.key}/${parent.key}.md) — ${parent.fields?.summary ?? ""}`);
    }

    for (const link of issueLinks) {
      const type = link.type?.outward ?? link.type?.name ?? "related to";
      const other = link.outwardIssue ?? link.inwardIssue;
      if (!other) continue;
      const dir = link.outwardIssue ? type : (link.type?.inward ?? type);
      lines.push(`- **${dir}:** [${other.key}](../${other.key}/${other.key}.md) — ${other.fields?.summary ?? ""}`);
    }

    for (const sub of subtasks) {
      lines.push(`- **Subtask:** [${sub.key}](../${sub.key}/${sub.key}.md) — ${sub.fields?.summary ?? ""}`);
    }

    lines.push("");
  }

  const HANDLED_FIELDS = new Set([
    "summary", "description", "comment", "issuelinks", "subtasks", "parent",
    "status", "issuetype", "priority", "assignee", "reporter", "created",
    "updated", "labels", "attachment", "worklog", "watches", "votes",
    "fixVersions", "versions", "components", "environment", "timetracking",
    "aggregatetimespent", "timespent", "timeestimate", "aggregatetimeestimate",
  ]);
  const names = issue.names ?? {};
  const disabled = new Set(disabledCustomFields);
  const discoveredFields = {};
  for (const [fieldId, renderedValue] of Object.entries(rendered)) {
    if (HANDLED_FIELDS.has(fieldId)) continue;
    if (!renderedValue || typeof renderedValue !== "string") continue;
    const fieldName = names[fieldId] ?? fieldId;
    discoveredFields[fieldId] = fieldName;
    if (disabled.has(fieldId)) continue;
    lines.push(`## ${fieldName}`);
    lines.push("");
    lines.push(htmlToMarkdown(renderedValue));
    lines.push("");
  }

  if (attachFiles.length) {
    lines.push("## Attachments");
    lines.push("");
    for (const name of attachFiles) {
      lines.push(`- [${name}](./attachments/${name})`);
    }
    lines.push("");
  }

  let md = lines.join("\n");

  for (const name of attachFiles) {
    const pattern = new RegExp(
      `(\\!?\\[([^\\]]*?)\\])\\(https?://[^)]+/attachment/[^)]*/${escapeRegex(name)}\\)`,
      "g",
    );
    md = md.replace(pattern, `$1(./attachments/${name})`);
  }

  return { md, discoveredFields };
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
