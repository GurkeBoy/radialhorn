import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { WandSchnitt } from "./WandSchnitt.jsx";

const map = (a, z) => [a, z];
const render = props => renderToStaticMarkup(<svg><WandSchnitt map={map} closeThroat={false} {...props} /></svg>);

describe("WandSchnitt", () => {
  it("zeichnet je Seite eine Fläche und eine Kante", () => {
    const html = render({ inner: [[10, 0], [20, 50]], outer: [[16, 0], [26, 50]] });
    expect(html.match(/<path /g)).toHaveLength(4);
  });

  it("ohne Punkte (sehr kurzes Horn mit Flansch: nichts hinter der Flanschebene) kein Absturz, nichts gezeichnet", () => {
    expect(render({ inner: [], outer: [] })).toBe("<svg></svg>");
    expect(render({ inner: [], outer: [[16, 0], [26, 50]] })).toBe("<svg></svg>");
    expect(render({ inner: undefined, outer: undefined })).toBe("<svg></svg>");
  });
});
