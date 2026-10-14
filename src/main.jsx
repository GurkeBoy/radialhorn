import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { GLOBAL_CSS } from "./theme.js";
import { FONT_CSS } from "./fonts.js";
import { isTauri, invoke } from "@tauri-apps/api/core";
import { initSettings } from "./settings.js";

const SETTINGS_FILE = import.meta.env.DEV ? "einstellungen-dev.json" : "einstellungen.json";

const style = document.createElement("style");
style.textContent = FONT_CSS + GLOBAL_CSS;
document.head.appendChild(style);
// Entwicklung: geänderte globale Stile ohne Neustart übernehmen (sonst bliebe der Stand vom Start)
if (import.meta.hot) {
  let global = GLOBAL_CSS, font = FONT_CSS;
  import.meta.hot.accept(["./theme.js", "./fonts.js"], ([theme, fonts]) => {
    if (theme) global = theme.GLOBAL_CSS;
    if (fonts) font = fonts.FONT_CSS;
    style.textContent = font + global;
  });
}

// Desktop-App: Einstellungen zusätzlich als Datei (settings.js) – vor dem ersten Rendern
// angebunden, weil die Regler ihre Werte beim Anlegen lesen. Eigene Datei für `tauri dev`.
const settingsReady = isTauri()
  ? initSettings({
      load: () => invoke("load_settings", { name: SETTINGS_FILE }),
      save: json => invoke("save_settings", { name: SETTINGS_FILE, json }),
    }).catch(e => console.error("Einstellungsdatei nicht lesbar, nur WebView2-Speicher:", e))
  : Promise.resolve();

settingsReady.finally(() => ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
));
