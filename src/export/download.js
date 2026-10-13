/**
 * Bietet content (Text oder ArrayBuffer) als Datei zum Speichern an.
 *
 * Mit „Speichern unter“-Dialog, wo der Browser ihn kennt (File System Access API: Chromium und
 * WebView2, also auch die Desktop-App): Ort und Name wählt man selbst, filename ist der Vorschlag.
 * Abbrechen speichert nichts. Ohne Dialog (z. B. Firefox) oder wenn er scheitert: als Download –
 * Blob-URL, für Text zusätzlich data-URL als Fallback.
 *
 * content darf auch eine Funktion sein, die den Inhalt erst liefert: Dann geht der Dialog sofort
 * auf (der Klick gilt nur kurz als Nutzeraktion) und gerechnet wird danach (STL, 3D-DXF).
 *
 * @returns {Promise<{ status: "saved" | "cancelled" | "downloaded", name: string }>}
 *   name: gewählter Dateiname (Dialog) bzw. der vorgeschlagene (Download)
 */
export async function downloadFile(content, filename, mime) {
  const make = async () => (typeof content === "function" ? await content() : content);
  const picker = globalThis.showSaveFilePicker;
  if (typeof picker === "function") {
    let handle = null;
    try {
      const ext = fileExtension(filename);
      handle = await picker({
        suggestedName: filename,
        types: ext ? [{ description: ext.slice(1).toUpperCase(), accept: { [mime]: [ext] } }] : undefined,
      });
    } catch (err) {
      if (err?.name === "AbortError") return { status: "cancelled", name: filename };   // Dialog abgebrochen
      // sonst (Dialog nicht erlaubt …) wie bisher als Download
    }
    if (handle) {
      const writable = await handle.createWritable();
      await writable.write(new Blob([await make()], { type: mime }));
      await writable.close();
      return { status: "saved", name: handle.name ?? filename };
    }
  }
  triggerDownload(await make(), filename, mime);
  return { status: "downloaded", name: filename };
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
