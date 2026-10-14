const SPOKEN_TEXT_LIMIT = 1500;

/**
 * Turns an assistant markdown message into text that Android Auto can read aloud.
 * Code is dropped because it is unreadable as speech; the full message stays in the app.
 */
export function toSpokenText(markdown: string): string {
  let text = markdown.replace(/\r\n/g, "\n");

  text = text.replace(/^\s*(```|~~~)[^\n]*\n[\s\S]*?^\s*\1[^\n]*$/gm, " (Code in der App) ");
  text = text.replace(/!\[([^\]]*)\]\((?:[^()\\]|\\.)*\)/g, "$1");
  text = text.replace(/\[([^\]]+)\]\((?:[^()\\]|\\.)*\)/g, "$1");
  text = text.replace(/^\s{0,3}#{1,6}\s+/gm, "");
  text = text.replace(/^\s{0,3}>+\s?/gm, "");
  text = text.replace(/^\s{0,3}(?:[*+-]|\d+\.)\s+/gm, "");
  text = text.replace(/^\s{0,3}(?:[-*_]\s*){3,}$/gm, "");
  text = text.replace(/^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?\s*$/gm, "");
  text = text.replace(/\s*\|\s*/g, ", ");
  text = text.replace(/`([^`]+)`/g, "$1");
  text = text.replace(/\*\*([^*]+)\*\*/g, "$1");
  text = text.replace(/__([^_]+)__/g, "$1");
  text = text.replace(/\*([^*\n]+)\*/g, "$1");
  text = text.replace(/_([^_\n]+)_/g, "$1");
  text = text.replace(/~~([^~]+)~~/g, "$1");
  text = text.replace(/<([^>\n]+)>/g, "$1");

  text = text
    .split("\n")
    .map((line) => line.replace(/^[,\s]+|[,\s]+$/g, "").trim())
    .filter((line) => line.length > 0)
    .join("\n");

  if (text.length <= SPOKEN_TEXT_LIMIT) return text;
  const cut = text.slice(0, SPOKEN_TEXT_LIMIT);
  const sentenceEnd = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("\n"));
  const trimmed = sentenceEnd > SPOKEN_TEXT_LIMIT / 2 ? cut.slice(0, sentenceEnd + 1) : cut;
  return `${trimmed.trimEnd()} … Der Rest steht in der App.`;
}
