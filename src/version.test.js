// Die Versionsnummer steht an drei Stellen; der Release-Workflow benennt Tag und Release nach
// tauri.conf.json, die App zeigt die aus package.json (Projektdateien). Sie müssen übereinstimmen.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");

describe("Version", () => {
  it("package.json, tauri.conf.json und Cargo.toml haben dieselbe Version", () => {
    const pkg = JSON.parse(read("../package.json")).version;
    const tauri = JSON.parse(read("../src-tauri/tauri.conf.json")).version;
    const cargo = read("../src-tauri/Cargo.toml").match(/^version\s*=\s*"([^"]+)"/m)?.[1];
    expect(pkg).toMatch(/^\d+\.\d+\.\d+$/);
    expect(tauri).toBe(pkg);
    expect(cargo).toBe(pkg);
  });
});
