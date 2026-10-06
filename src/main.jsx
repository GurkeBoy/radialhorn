import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { GLOBAL_CSS } from "./theme.js";
import { FONT_CSS } from "./fonts.js";

const style = document.createElement("style");
style.textContent = FONT_CSS + GLOBAL_CSS;
document.head.appendChild(style);

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
