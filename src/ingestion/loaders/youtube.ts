import { GoogleGenerativeAI } from "@google/generative-ai";
import type { LoadedDocument, LoadOptions } from "../loader.js";

// ─── URL detection ────────────────────────────────────────────────────────────

export function isYoutubeUrl(url: string): boolean {
  return /^https?:\/\/(www\.)?(youtube\.com|youtu\.be)/.test(url);
}

function extractVideoId(url: string): string {
  const patterns = [
    /[?&]v=([a-zA-Z0-9_-]{11})/,      // youtube.com/watch?v=ID
    /\/shorts\/([a-zA-Z0-9_-]{11})/,   // youtube.com/shorts/ID
    /youtu\.be\/([a-zA-Z0-9_-]{11})/,  // youtu.be/ID
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match?.[1]) return match[1];
  }
  throw new Error(`Cannot extract video ID from: ${url}`);
}

// ─── YouTube Data API v3 — metadata ──────────────────────────────────────────

interface YoutubeApiVideo {
  snippet: {
    title: string;
    description: string;
    channelTitle: string;
    publishedAt: string;
    tags?: string[];
    thumbnails: { high?: { url: string }; default?: { url: string } };
  };
  contentDetails: { duration: string };
}

async function fetchVideoMetadata(videoId: string, apiKey: string | undefined): Promise<YoutubeApiVideo> {
  // Primary: YouTube Data API v3 (requires API key with YouTube Data API v3 enabled)
  if (apiKey) {
    console.log(`  [youtube:meta] Using YouTube Data API v3 for ${videoId}`);
    const url =
      `https://www.googleapis.com/youtube/v3/videos` +
      `?part=snippet,contentDetails&id=${videoId}&key=${apiKey}`;

    const response = await fetch(url);
    console.log(`  [youtube:meta] API response: HTTP ${response.status}`);

    if (response.ok) {
      const data = await response.json() as { items?: YoutubeApiVideo[] };
      if (data.items?.length) {
        const item = data.items[0]!;
        console.log(`  [youtube:meta] API OK — title="${item.snippet.title}" channel="${item.snippet.channelTitle}" duration="${item.contentDetails.duration}" descLen=${item.snippet.description.length}chars`);
        return item;
      }
      console.warn(`  [youtube:meta] API returned 0 items, falling back to scraping`);
    }
    // Non-fatal: fall through to HTML scraping
    if (response.status !== 403 && response.status !== 400) {
      console.warn(`  [youtube:meta] API returned ${response.status}, falling back to HTML scraping`);
    } else {
      console.warn(`  [youtube:meta] API key rejected (${response.status}), falling back to HTML scraping`);
    }
  } else {
    console.log(`  [youtube:meta] No API key — using HTML scraping for ${videoId}`);
  }

  // Fallback: scrape OG tags from YouTube page (no API key needed)
  return scrapeYoutubeMetadata(videoId);
}

async function scrapeYoutubeMetadata(videoId: string): Promise<YoutubeApiVideo> {
  const { load } = await import("cheerio");
  const url = `https://www.youtube.com/watch?v=${videoId}`;
  console.log(`  [youtube:scrape] Fetching ${url}`);

  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept-Language": "en-US,en;q=0.9",
    },
  });

  if (!response.ok) {
    throw new Error(`Cannot fetch YouTube page ${videoId}: ${response.status}`);
  }

  const html = await response.text();
  const $ = load(html);

  const title =
    $('meta[property="og:title"]').attr("content") ||
    $("title").text().replace(" - YouTube", "").trim() ||
    `YouTube video ${videoId}`;

  const description =
    $('meta[property="og:description"]').attr("content") ||
    $('meta[name="description"]').attr("content") ||
    "";

  const thumbnail =
    $('meta[property="og:image"]').attr("content") || "";

  // Channel name: in the page JSON or meta author
  const channelMeta =
    $('meta[itemprop="channelId"]').attr("content") ||
    $('span[itemprop="author"] link[itemprop="name"]').attr("content") ||
    "";

  // Try to extract from ytInitialData JSON embedded in the page
  let channelTitle = channelMeta;
  let tags: string[] = [];
  const scriptMatch = html.match(/"author":"([^"]+)"/);
  if (scriptMatch?.[1]) channelTitle = scriptMatch[1];
  const keywordsMatch = html.match(/"keywords":"([^"]+)"/);
  if (keywordsMatch?.[1]) {
    tags = keywordsMatch[1].split(",").map((t) => t.trim()).filter(Boolean);
  }

  console.log(`  [youtube:scrape] OK — title="${title}" channel="${channelTitle || "Unknown"}" descLen=${description.length}chars thumbnail=${thumbnail ? "found" : "MISSING"}`);
  return {
    snippet: {
      title,
      description,
      channelTitle: channelTitle || "Unknown channel",
      publishedAt: new Date().toISOString(),
      tags,
      thumbnails: {
        ...(thumbnail ? { high: { url: thumbnail } } : {}),
      },
    },
    contentDetails: {
      duration: "PT0S", // unknown from scraping
    },
  };
}

function formatDuration(iso: string): string {
  // "PT4M13S" → "4:13", "PT1H2M3S" → "1:02:03"
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return "0:00";
  const h = parseInt(m[1] ?? "0");
  const min = parseInt(m[2] ?? "0");
  const s = parseInt(m[3] ?? "0");
  if (h > 0) return `${h}:${String(min).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${min}:${String(s).padStart(2, "0")}`;
}

// ─── youtube-transcript — transcript text ─────────────────────────────────────

interface TranscriptSegment { text: string; offset: number; duration: number; }

async function fetchTranscript(videoId: string): Promise<TranscriptSegment[] | null> {
  console.log(`  [youtube:transcript] Attempting to fetch transcript for ${videoId}`);
  try {
    const { YoutubeTranscript } = await import("youtube-transcript");
    const items = await YoutubeTranscript.fetchTranscript(videoId) as TranscriptSegment[];
    console.log(`  [youtube:transcript] OK — ${items.length} segments`);
    return items;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`  [youtube:transcript] NONE — ${message}`);
    return null;
  }
}

/**
 * Group transcript segments into ~N-minute sections with [MM:SS] timestamps.
 * Produces readable chunks that reference where in the video the content is.
 */
function groupTranscriptBySections(segments: TranscriptSegment[], sectionSeconds = 120): string {
  if (segments.length === 0) return "";

  const lines: string[] = [];
  let currentLines: string[] = [];
  let sectionStart = 0;

  for (const seg of segments) {
    const offsetSec = Math.floor((seg.offset ?? 0) / 1000);

    if (offsetSec - sectionStart >= sectionSeconds && currentLines.length > 0) {
      const mm = String(Math.floor(sectionStart / 60)).padStart(2, "0");
      const ss = String(sectionStart % 60).padStart(2, "0");
      lines.push(`[${mm}:${ss}] ${currentLines.join(" ").replace(/\s+/g, " ").trim()}`);
      currentLines = [];
      sectionStart = offsetSec;
    }

    currentLines.push(seg.text.trim());
  }

  if (currentLines.length > 0) {
    const mm = String(Math.floor(sectionStart / 60)).padStart(2, "0");
    const ss = String(sectionStart % 60).padStart(2, "0");
    lines.push(`[${mm}:${ss}] ${currentLines.join(" ").replace(/\s+/g, " ").trim()}`);
  }

  return lines.join("\n\n");
}

// ─── Vision AI — Gemini thumbnail analysis ────────────────────────────────────

type ImagePart = { inlineData: { mimeType: "image/jpeg" | "image/png" | "image/webp"; data: string } };

async function fetchImagePart(url: string): Promise<ImagePart | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.log(`  [youtube:image] SKIP ${url} → HTTP ${res.status}`);
      return null;
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    // YouTube auto-thumbnails are always JPEG
    const mimeType = (res.headers.get("content-type") ?? "image/jpeg").split(";")[0]!.trim() as
      | "image/jpeg"
      | "image/png"
      | "image/webp";
    console.log(`  [youtube:image] OK   ${url} → ${(buffer.length / 1024).toFixed(1)} KB (${mimeType})`);
    return { inlineData: { mimeType, data: buffer.toString("base64") } };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.log(`  [youtube:image] FAIL ${url} → ${message}`);
    return null;
  }
}

async function generateVisualDescription(
  videoId: string,
  title: string,
  thumbnailUrl: string,
  googleApiKey: string,
  visionPrompt?: string,
): Promise<string | null> {
  try {
    // Fetch up to 4 images in parallel:
    //   - API/scraped thumbnail (highest quality, custom)
    //   - YouTube auto-frames: ~25%, ~50%, ~75% of video duration
    const autoUrls = [
      `https://img.youtube.com/vi/${videoId}/1.jpg`,
      `https://img.youtube.com/vi/${videoId}/2.jpg`,
      `https://img.youtube.com/vi/${videoId}/3.jpg`,
    ];

    const [mainPart, ...autoParts] = await Promise.all([
      fetchImagePart(thumbnailUrl),
      ...autoUrls.map(fetchImagePart),
    ]);

    const imageParts = [mainPart, ...autoParts].filter((p): p is ImagePart => p !== null);

    if (imageParts.length === 0) {
      console.warn(`  [youtube:vision] No images available for ${videoId}`);
      return null;
    }

    console.log(`  [youtube:vision] Calling Gemini with ${imageParts.length} image(s) for "${title}"`);

    const genai = new GoogleGenerativeAI(googleApiKey);
    const model = genai.getGenerativeModel({ model: "gemini-2.5-flash" });

    const promptSource = visionPrompt ? "from @vision directive"
      : process.env["VISION_AI_PROMPT"] ? "from VISION_AI_PROMPT env"
      : "default generic prompt";
    const rawPrompt = visionPrompt
      ?? process.env["VISION_AI_PROMPT"]
      ?? `Este es el thumbnail de un video de YouTube llamado "{title}". ` +
         `Describe detalladamente lo que ves: tema principal, elementos visuales clave, ` +
         `personas, objetos, acciones, texto visible en la imagen. ` +
         `Sé específico y útil para alguien que quiere entender de qué trata este video.`;
    const prompt = rawPrompt.replace(/\{title\}/g, title);
    console.log(`  [youtube:vision] Prompt source: ${promptSource} (${prompt.length} chars)`);

    const result = await model.generateContent([...imageParts, prompt]);

    const text = result.response.text().trim();
    console.log(`  [youtube:vision] Gemini response: ${text.length} chars`);
    return text || null;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`  [youtube] Vision AI failed for ${videoId}: ${message}`);
    return null;
  }
}

// ─── Main loader ──────────────────────────────────────────────────────────────

export async function loadYoutubeVideo(url: string, options?: LoadOptions): Promise<LoadedDocument> {
  // YouTube Data API key (also accepts GOOGLE_API_KEY as fallback)
  const youtubeApiKey = process.env["YOUTUBE_API_KEY"] ?? process.env["GOOGLE_API_KEY"];
  // Gemini API key for Vision AI thumbnail analysis
  const googleApiKey = process.env["GOOGLE_API_KEY"] ?? process.env["GOOGLE_GENERATIVE_AI_API_KEY"];

  const videoId = extractVideoId(url);
  const canonicalUrl = `https://www.youtube.com/watch?v=${videoId}`;
  console.log(`\n[youtube] Loading ${canonicalUrl}`);
  console.log(`  [youtube] youtubeApiKey=${youtubeApiKey ? "SET" : "NOT SET"} googleApiKey=${googleApiKey ? "SET" : "NOT SET"}`);

  const [video, transcriptSegments] = await Promise.all([
    fetchVideoMetadata(videoId, youtubeApiKey),
    fetchTranscript(videoId),
  ]);

  const { snippet, contentDetails } = video;
  const duration = formatDuration(contentDetails.duration);
  const tags = snippet.tags ?? [];
  const thumbnail =
    snippet.thumbnails.high?.url ?? snippet.thumbnails.default?.url ?? "";

  console.log(`  [youtube] transcript=${transcriptSegments ? `${transcriptSegments.length} segments` : "NONE"} thumbnail=${thumbnail || "MISSING"}`);

  // Content section 3: transcript (with timestamps) OR Vision AI analysis
  let contentSection: string | null = null;
  let isVisualAnalysis = false;

  if (transcriptSegments && transcriptSegments.length > 0) {
    console.log(`  [youtube] Transcript available — building timestamped sections`);
    contentSection = groupTranscriptBySections(transcriptSegments, 120); // 2-min sections
  } else if (thumbnail && googleApiKey) {
    console.log(`  [youtube] No transcript → attempting Vision AI`);
    contentSection = await generateVisualDescription(videoId, snippet.title, thumbnail, googleApiKey, options?.visionPrompt);
    if (contentSection) isVisualAnalysis = true;
  } else if (!thumbnail) {
    console.warn(`  [youtube] No transcript AND no thumbnail — storing metadata only`);
  } else if (!googleApiKey) {
    console.warn(`  [youtube] No transcript AND no GOOGLE_API_KEY — skipping Vision AI`);
  }

  // ── Structured content with ## headers so hierarchical chunker splits naturally ──
  //
  // Chunk 1 (Introduction): title + metadata — always present
  // Chunk 2 (Descripción): video description — if non-empty
  // Chunk 3+ (Transcripción / Análisis Visual): content — split by section size
  //
  const parts: string[] = [];

  // Section 1: Metadata
  const metaLines = [
    `# ${snippet.title}`,
    `**Canal:** ${snippet.channelTitle} | **Duración:** ${duration}`,
    ...(tags.length ? [`**Tags:** ${tags.join(", ")}`] : []),
    ...(thumbnail ? [`**Thumbnail:** ${thumbnail}`] : []),
  ];
  parts.push(metaLines.join("\n"));

  // Section 2: Description (only if meaningful)
  const desc = snippet.description?.trim();
  if (desc && desc.length > 20) {
    parts.push(`## Descripción\n${desc}`);
  }

  // Section 3+: Transcript or Vision AI
  if (contentSection) {
    const sectionTitle = isVisualAnalysis ? "## Análisis Visual" : "## Transcripción";
    parts.push(`${sectionTitle}\n${contentSection}`);
  }

  const content = parts.join("\n\n");

  console.log(`  [youtube] Content built: ${parts.length} sections, ${content.length} chars, isVisualAnalysis=${isVisualAnalysis}`);

  return {
    content,
    metadata: {
      title: snippet.title,
      source: canonicalUrl,
      contentType: "youtube",
      size: Buffer.byteLength(content, "utf-8"),
      ...({
        youtubeId: videoId,
        channel: snippet.channelTitle,
        duration,
        durationSeconds: parseDurationSeconds(contentDetails.duration),
        tags,
        thumbnailUrl: thumbnail,
        hasTranscript: transcriptSegments !== null && !isVisualAnalysis,
        hasVisualAnalysis: isVisualAnalysis,
        publishedAt: snippet.publishedAt,
      } as object),
    },
  };
}

function parseDurationSeconds(iso: string): number {
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  return (parseInt(m[1] ?? "0") * 3600) +
         (parseInt(m[2] ?? "0") * 60) +
          parseInt(m[3] ?? "0");
}
