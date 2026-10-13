import { describe, it, expect, afterEach } from "vitest";
import { downloadFile, fileExtension } from "./download.js";

afterEach(() => { delete globalThis.showSaveFilePicker; });

describe("downloadFile", () => {
  it("mit Speichern-Dialog: Vorschlag für Name und Typ, Inhalt wird geschrieben", async () => {
    let options, written, closed = false;
    globalThis.showSaveFilePicker = async opts => {
      options = opts;
      return { createWritable: async () => ({ write: async blob => { written = await blob.text(); }, close: async () => { closed = true; } }) };
    };
    const result = await downloadFile("{\"a\":1}", "radialhorn_140deg_L500.radialhorn.json", "application/json");
    expect(result).toEqual({ status: "saved", name: "radialhorn_140deg_L500.radialhorn.json" });
    expect(options.suggestedName).toBe("radialhorn_140deg_L500.radialhorn.json");
    expect(options.types).toEqual([{ description: "JSON", accept: { "application/json": [".json"] } }]);
    expect(written).toBe("{\"a\":1}");
    expect(closed).toBe(true);
  });

  it("Dialog abgebrochen: nichts gespeichert, kein Download als Ersatz", async () => {
    globalThis.showSaveFilePicker = async () => { throw Object.assign(new Error("abgebrochen"), { name: "AbortError" }); };
    // ohne document würde ein Download-Versuch scheitern – „cancelled“ heißt: keiner
    expect(await downloadFile("x", "a.csv", "text/csv")).toEqual({ status: "cancelled", name: "a.csv" });
  });

  it("Inhalt als Funktion: erst der Dialog, dann gerechnet; gewählter Name zurück; abgebrochen → nie gerechnet", async () => {
    const order = [];
    globalThis.showSaveFilePicker = async () => {
      order.push("Dialog");
      return { name: "mein-horn.stl", createWritable: async () => ({ write: async () => order.push("geschrieben"), close: async () => {} }) };
    };
    const result = await downloadFile(() => { order.push("gerechnet"); return "x"; }, "horn.stl", "model/stl");
    expect(order).toEqual(["Dialog", "gerechnet", "geschrieben"]);
    expect(result).toEqual({ status: "saved", name: "mein-horn.stl" });
    let computed = false;
    globalThis.showSaveFilePicker = async () => { throw Object.assign(new Error("abgebrochen"), { name: "AbortError" }); };
    await downloadFile(() => { computed = true; return "x"; }, "horn.stl", "model/stl");
    expect(computed).toBe(false);
  });

  it("Binärdaten (STL) werden unverändert geschrieben", async () => {
    let bytes;
    globalThis.showSaveFilePicker = async () => ({ createWritable: async () => ({ write: async blob => { bytes = new Uint8Array(await blob.arrayBuffer()); }, close: async () => {} }) });
    const data = new Uint8Array([0, 1, 2, 250, 255]).buffer;
    expect((await downloadFile(data, "horn.stl", "model/stl")).status).toBe("saved");
    expect([...bytes]).toEqual([0, 1, 2, 250, 255]);
  });
});

describe("fileExtension", () => {
  it("letzte Endung, klein geschrieben", () => {
    expect(fileExtension("x.radialhorn.json")).toBe(".json");
    expect(fileExtension("Horn.STL")).toBe(".stl");
    expect(fileExtension("ohne")).toBe("");
    expect(fileExtension(".hidden")).toBe("");
  });
});
