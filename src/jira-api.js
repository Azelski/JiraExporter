export async function fetchIssue(baseUrl, issueKey) {
  const url = `${baseUrl}/rest/api/2/issue/${encodeURIComponent(issueKey)}?expand=renderedFields`;

  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) {
    throw new Error(`Failed to fetch issue ${issueKey}: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

export async function fetchAttachment(contentUrl) {
  const res = await fetch(contentUrl, { credentials: "include" });
  if (!res.ok) {
    throw new Error(`Failed to download attachment: ${res.status} ${contentUrl}`);
  }
  return res.arrayBuffer();
}
