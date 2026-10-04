import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

export interface PdfPageText {
  page: number;
  text: string;
}

export interface TextChunk {
  page: number;
  chunkIndex: number;
  content: string;
}

export async function extractPdfPages(
  bytes: Uint8Array,
): Promise<PdfPageText[]> {
  const loadingTask = getDocument({
    data: new Uint8Array(bytes),
    isEvalSupported: false,
  });
  const pdf = await loadingTask.promise;
  try {
    if (pdf.numPages > 500) {
      throw new Error("This PDF exceeds the 500-page indexing limit.");
    }
    const pages: PdfPageText[] = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = content.items
        .filter((item): item is typeof item & { str: string } => "str" in item)
        .map((item) => `${item.str}${"hasEOL" in item && item.hasEOL ? "\n" : " "}`)
        .join("")
        .replace(/[ \t]+\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
      pages.push({ page: pageNumber, text });
      page.cleanup();
    }
    return pages;
  } finally {
    await pdf.destroy();
  }
}

export function chunkPdfPages(
  pages: PdfPageText[],
  maxChunkLength = 1100,
  overlap = 140,
): TextChunk[] {
  const chunks: TextChunk[] = [];
  let chunkIndex = 0;
  for (const page of pages) {
    const normalized = page.text.replace(/\s+/g, " ").trim();
    if (!normalized) continue;
    let start = 0;
    while (start < normalized.length) {
      let end = Math.min(start + maxChunkLength, normalized.length);
      if (end < normalized.length) {
        const sentenceBreak = normalized.lastIndexOf(". ", end);
        if (sentenceBreak > start + Math.floor(maxChunkLength * 0.65)) {
          end = sentenceBreak + 1;
        }
      }
      const content = normalized.slice(start, end).trim();
      if (content) chunks.push({ page: page.page, chunkIndex, content });
      chunkIndex += 1;
      if (end >= normalized.length) break;
      start = Math.max(end - overlap, start + 1);
    }
  }
  return chunks;
}

export function parseJsonObject(text: string): Record<string, unknown> {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new Error("Gemini returned invalid structured data.");
  }
  const parsed: unknown = JSON.parse(cleaned.slice(start, end + 1));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Gemini returned invalid structured data.");
  }
  return parsed as Record<string, unknown>;
}