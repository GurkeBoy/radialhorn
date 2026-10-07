/**
 * Bietet content (Text oder ArrayBuffer) als Datei zum Speichern an.
 *
 * Mit „Speichern unter“-Dialog, wo der Browser ihn kennt (File System Access API: Chromium und
 * WebView2, also auch die Desktop-App): Ort und Name wählt man selbst, filename ist der Vorschlag.
 * Abbrechen speichert nichts. Ohne Dialog (z. B. Firefox) oder wenn er scheitert: als Download –
 * Blob-URL, für Text zusätzlich data-URL als Fallback.
 *
 * @returns {Promise<"saved" | "cancelled" | "downloaded">}
 */
export async function downloadFile(content, filename, mime) {
  const picker = globalThis.showSaveFilePicker;
  if (typeof picker === "function") {
    try {
      const ext = fileExtension(filename);
      const handle = await picker({
        suggestedName: filename,
        types: ext ? [{ description: ext.slice(1).toUpperCase(), accept: { [mime]: [ext] } }] : undefined,
      });
      const writable = await handle.createWritable();
      await writable.write(new Blob([content], { type: mime }));
      await writable.close();
      return "saved";
    } catch (err) {
      if (err?.name === "AbortError") return "cancelled";   // Dialog abgebrochen
      // sonst (Dialog nicht erlaubt, Schreiben gescheitert …) wie bisher als Download
    }
  }
  triggerDownload(content, filename, mime);
  return "downloaded";
}

/** Letzte Endung samt Punkt, z. B. ".json" für „x.radialhorn.json“; "" ohne Endung. */
export function fileExtension(filename) {
  const i = filename.lastIndexOf(".");
  return i > 0 ? filename.slice(i).toLowerCase() : "";
}

function triggerDownload(content, filename, mime) {
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
