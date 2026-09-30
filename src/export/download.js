/**
 * Bietet content (Text oder ArrayBuffer) als Datei zum Speichern an.
 * Blob-URL; für Text zusätzlich data-URL als Fallback.
 */
export function downloadFile(content, filename, mime) {
  const trigger = href => {
    const a = document.createElement("a");
    a.href = href;
    a.download = filename;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    return a;
  };
  try {
    const url = URL.createObjectURL(new Blob([content], { type: mime }));
    const a = trigger(url);
    setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 100);
  } catch (err) {
    if (typeof content !== "string") throw err;
    trigger(`data:${mime};charset=utf-8,${encodeURIComponent(content)}`).remove();
  }
}
