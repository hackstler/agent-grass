import { readFile } from "fs/promises";
import { extname } from "path";
import { isYoutubeUrl, loadYoutubeVideo } from "./loaders/youtube.js";

export interface LoadedDocument {
  content: string;
  metadata: {
    title: string;
    source: string;
    contentType: "pdf" | "markdown" | "html" | "code" | "text" | "url" | "youtube";
    size: number;
    pageCount?: number;
  };
}

export interface LoadOptions {
  visionPrompt?: string;
}

/**
 * Load a document from a file path or URL and extract its text content.
 */
export async function loadDocument(source: string, options?: LoadOptions): Promise<LoadedDocument> {
  const isUrl = source.startsWith("http://") || source.startsWith("https://");

  if (isUrl) {
    if (isYoutubeUrl(source)) return loadYoutubeVideo(source, options);
    return loadUrl(source);
  }

  const ext = extname(source).toLowerCase();
  switch (ext) {
    case ".pdf":
      return loadPdf(source);
    case ".md":
    case ".mdx":
      return loadMarkdown(source);
    case ".html":
    case ".htm":
      return loadHtml(source);
    case ".txt":
      return loadText(source);
    default:
      // Treat as code file
      return loadCode(source);
  }
}

async function loadPdf(filePath: string): Promise<LoadedDocument> {
  // Dynamic import to avoid loading pdfjs-dist unless needed
  const { getDocument } = await import("pdfjs-dist");
  const data = await readFile(filePath);
  const pdf = await getDocument({ data }).promise;

  const pages: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ");
    pages.push(pageText);
  }

  const content = pages.join("\n\n");
  const stats = await readFile(filePath).then((b) => b.length);

  return {
    content,
    metadata: {
      title: filePath.split("/").pop()?.replace(".pdf", "") ?? "Document",
      source: filePath,
      contentType: "pdf",
      size: stats,
      pageCount: pdf.numPages,
    },
  };
}

async function loadMarkdown(filePath: string): Promise<LoadedDocument> {
  const content = await readFile(filePath, "utf-8");
  const stats = Buffer.byteLength(content, "utf-8");

  // Extract title from first # heading
  const titleMatch = content.match(/^#\s+(.+)$/m);
  const title = titleMatch?.[1] ?? filePath.split("/").pop()?.replace(/\.(md|mdx)$/, "") ?? "Document";

  return {
    content,
    metadata: {
      title,
      source: filePath,
      contentType: "markdown",
      size: stats,
    },
  };
}

async function loadHtml(filePath: string): Promise<LoadedDocument> {
  const { load } = await import("cheerio");
  const html = await readFile(filePath, "utf-8");
  const $ = load(html);

  // Remove script and style tags
  $("script, style, nav, footer, header").remove();

  const title = $("title").text() || $("h1").first().text() || "Document";
  const content = $("body").text().replace(/\s+/g, " ").trim();

  return {
    content,
    metadata: {
      title,
      source: filePath,
      contentType: "html",
      size: Buffer.byteLength(html, "utf-8"),
    },
  };
}

async function loadText(filePath: string): Promise<LoadedDocument> {
  const content = await readFile(filePath, "utf-8");
  return {
    content,
    metadata: {
      title: filePath.split("/").pop()?.replace(".txt", "") ?? "Document",
      source: filePath,
      contentType: "text",
      size: Buffer.byteLength(content, "utf-8"),
    },
  };
}

async function loadCode(filePath: string): Promise<LoadedDocument> {
  const content = await readFile(filePath, "utf-8");
  const filename = filePath.split("/").pop() ?? "code";

  return {
    content: `// File: ${filename}\n\n${content}`,
    metadata: {
      title: filename,
      source: filePath,
      contentType: "code",
      size: Buffer.byteLength(content, "utf-8"),
    },
  };
}

async function loadUrl(url: string): Promise<LoadedDocument> {
  const { load } = await import("cheerio");
  const response = await fetch(url, {
    headers: { "User-Agent": "rag-agent-backbone/1.0 (document ingestion)" },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch URL ${url}: ${response.statusText}`);
  }

  const html = await response.text();
  const $ = load(html);

  $("script, style, nav, footer, header, .ad, #ads").remove();

  const title = $("title").text() || $("h1").first().text() || new URL(url).hostname;
  const content = $("main, article, .content, body").first().text().replace(/\s+/g, " ").trim();

  return {
    content,
    metadata: {
      title,
      source: url,
      contentType: "url",
      size: Buffer.byteLength(html, "utf-8"),
    },
  };
}
