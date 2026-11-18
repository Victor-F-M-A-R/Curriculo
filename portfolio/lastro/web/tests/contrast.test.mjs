import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const css = readFileSync(new URL("../src/style.css", import.meta.url), "utf8");

function luminance(hex) {
  const channels = hex.match(/../g).map((pair) => {
    const value = Number.parseInt(pair, 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

test("all five ledger statuses meet the 4.5:1 text contrast threshold", () => {
  const checked = new Set();
  for (const [, selectors, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const foreground = body.match(/--c:\s*#([0-9a-f]{6});/i);
    const background = body.match(/--p:\s*#([0-9a-f]{6});/i);
    if (!foreground || !background) continue;
    const dark = luminance(foreground[1]);
    const light = luminance(background[1]);
    const ratio = (Math.max(dark, light) + 0.05) / (Math.min(dark, light) + 0.05);
    for (const selector of selectors.trim().split(/,\s*/)) {
      assert.ok(ratio >= 4.5, selector + " has a contrast of " + ratio.toFixed(2) + ":1");
      checked.add(selector);
    }
  }
  assert.deepEqual([...checked].sort(), [".disputed", ".matched", ".orphan", ".pending", ".reviewed"]);
});
