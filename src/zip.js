import JSZip from "jszip";

export async function buildZip(rootKey, issues, indexMd) {
  const zip = new JSZip();
  const root = zip.folder(rootKey);

  if (indexMd) {
    root.file("INDEX.md", indexMd);
  }

  for (const { key, md, attachments } of issues) {
    const folder = root.folder(key);
    folder.file(`${key}.md`, md);

    if (attachments.length) {
      const attachDir = folder.folder("attachments");
      for (const { name, data } of attachments) {
        attachDir.file(name, data);
      }
    }
  }

  return zip.generateAsync({ type: "base64" });
}
