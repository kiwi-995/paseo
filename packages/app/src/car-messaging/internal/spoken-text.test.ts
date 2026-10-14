import { describe, expect, it } from "vitest";
import { toSpokenText } from "./spoken-text";

describe("toSpokenText", () => {
  it("strips markdown structure and keeps the words", () => {
    const text = toSpokenText(
      "## Ergebnis\n\n- **Tests** sind grün\n- PR [#12](https://example.com) wartet auf `review`",
    );
    expect(text).toBe("Ergebnis\nTests sind grün\nPR #12 wartet auf review");
  });

  it("replaces code blocks instead of reading them aloud", () => {
    const text = toSpokenText("Fix:\n```ts\nconst a = 1;\n```\nFertig.");
    expect(text).toBe("Fix:\n(Code in der App)\nFertig.");
  });

  it("shortens long messages at a sentence and points to the app", () => {
    const sentence = "Das ist ein Satz mit etwas Inhalt. ";
    const text = toSpokenText(sentence.repeat(100));
    expect(text.length).toBeLessThan(1600);
    expect(text.endsWith("Der Rest steht in der App.")).toBe(true);
    expect(text).toContain("Inhalt. …");
  });
});
