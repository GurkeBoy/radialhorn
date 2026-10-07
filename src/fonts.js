// Eingebettete Schrift DM Mono (SIL Open Font License 1.1, assets/fonts/OFL.txt), damit die App
// überall gleich aussieht und offline funktioniert. Quelle: Google Fonts (v16), Schnitte 400 und 500
// – DM Mono hat keinen fetteren Schnitt. Je Schnitt „latin“ und „latin-ext“ (darin u. a. ℓ).
import regularLatin from "./assets/fonts/DMMono-400-latin.woff2";
import regularLatinExt from "./assets/fonts/DMMono-400-latin-ext.woff2";
import mediumLatin from "./assets/fonts/DMMono-500-latin.woff2";
import mediumLatinExt from "./assets/fonts/DMMono-500-latin-ext.woff2";
// Fürs PDF-Datenblatt als data:-URL (Vite ?inline): das Dokument läuft in eigenem Fenster bzw. als
// gespeicherte HTML-Datei und kommt an die Schriftdateien der App nicht heran
import regularLatinInline from "./assets/fonts/DMMono-400-latin.woff2?inline";
import mediumLatinInline from "./assets/fonts/DMMono-500-latin.woff2?inline";

// unicode-range wie bei Google Fonts
const LATIN = "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, "
  + "U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD";
const LATIN_EXT = "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, "
  + "U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C4, U+2113, U+2C60-2C7F, U+A720-A7FF";

const face = (weight, url, range) => `@font-face {
  font-family: 'DM Mono'; font-style: normal; font-weight: ${weight}; font-display: swap;
  src: url(${url}) format('woff2'); unicode-range: ${range};
}`;

/**
 * @font-face-Regeln mit eingebetteter Schrift (nur „latin“, ≈ 40 KB) für das PDF-Datenblatt –
 * es enthält keine Zeichen aus latin-ext.
 */
export const FONT_CSS_EMBEDDED = [face(400, regularLatinInline, LATIN), face(500, mediumLatinInline, LATIN)].join("\n");

/** @font-face-Regeln für main.jsx. */
export const FONT_CSS = [
  face(400, regularLatinExt, LATIN_EXT), face(400, regularLatin, LATIN),
  face(500, mediumLatinExt, LATIN_EXT), face(500, mediumLatin, LATIN),
].join("\n");
