import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ORION_PALETTE, ORION_CONTRAST_PAIRS, contrastRatio, resolveBrand } from "./orion-tokens.js";

test("every ORION text/background pair meets WCAG AA (4.5:1)", () => {
  for (const [fg, bg] of ORION_CONTRAST_PAIRS) {
    const ratio = contrastRatio(ORION_PALETTE[fg], ORION_PALETTE[bg]);
    assert.ok(ratio >= 4.5, `${fg} on ${bg} is ${ratio.toFixed(2)}:1`);
  }
});

test("contrastRatio matches known reference values", () => {
  assert.equal(contrastRatio("#000000", "#ffffff").toFixed(1), "21.0");
  assert.equal(contrastRatio("#ffffff", "#ffffff").toFixed(1), "1.0");
});

test("orion-theme.css declares exactly the palette values (no drift)", () => {
  const css = readFileSync(new URL("./orion-theme.css", import.meta.url), "utf8");
  for (const [name, value] of Object.entries(ORION_PALETTE)) {
    const token = `--orion-${name.replace(/([a-z])(\d)/g, "$1-$2")}`;
    assert.match(css, new RegExp(`${token}:\\s*${value}\\b`, "i"), `${token} missing or different`);
  }
});

test("brand stays FinanFlow unless ORION is explicitly enabled", () => {
  assert.equal(resolveBrand({}), "finanflow");
  assert.equal(resolveBrand({ envFlag: "false", search: "", stored: null }), "finanflow");
  assert.equal(resolveBrand({ envFlag: "true" }), "orion");
  assert.equal(resolveBrand({ search: "?brand=orion" }), "orion");
  assert.equal(resolveBrand({ stored: "orion" }), "orion");
});

test("?brand=finanflow overrides a stored ORION preview", () => {
  assert.equal(resolveBrand({ search: "?brand=finanflow", stored: "orion" }), "finanflow");
});

test("unknown brand values fall back to FinanFlow", () => {
  assert.equal(resolveBrand({ search: "?brand=outra", stored: "lixo" }), "finanflow");
});
