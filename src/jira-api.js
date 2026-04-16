export async function fetchJiraIssue(baseUrl, issueKey) {
  const url = `${baseUrl}/rest/api/2/issue/${encodeURIComponent(issueKey)}?expand=renderedFields,names`;

  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) {
    throw new Error(`Failed to fetch issue ${issueKey}: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

export async function fetchBinaryAttachment(contentUrl) {
  const res = await fetch(contentUrl, { credentials: "include" });
  if (!res.ok) {
    throw new Error(`Failed to download attachment: ${res.status} ${contentUrl}`);
  }
  return res.arrayBuffer();
}

export async function fetchConfluencePage(baseUrl, pageId) {
  const url = `${baseUrl}/wiki/rest/api/content/${encodeURIComponent(pageId)}?expand=body.view,space,ancestors,children.page,version,metadata.labels,history`;
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) {
    throw new Error(`Failed to fetch Confluence page ${pageId}: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

export async function fetchConfluencePageAttachments(baseUrl, pageId) {
  const url = `${baseUrl}/wiki/rest/api/content/${encodeURIComponent(pageId)}/child/attachment?limit=100`;
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) {
    throw new Error(`Failed to fetch attachments for page ${pageId}: ${res.status} ${res.statusText}`);
  }
  const data = await res.json();
  return data.results ?? [];
}

export async function fetchConfluenceComments(baseUrl, pageId) {
  const url = `${baseUrl}/wiki/rest/api/content/${encodeURIComponent(pageId)}/child/comment?expand=body.view,version&limit=100`;
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) {
    throw new Error(`Failed to fetch comments for page ${pageId}: ${res.status} ${res.statusText}`);
  }
  const data = await res.json();
  return data.results ?? [];
}
