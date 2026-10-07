import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { GLOBAL_CSS } from "./theme.js";
import { FONT_CSS } from "./fonts.js";

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

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
