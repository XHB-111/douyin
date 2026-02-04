const MOBILE_USER_AGENT =
  "Mozilla/5.0 (Linux; Android 11; SAMSUNG SM-G973U) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/14.2 Chrome/87.0.4280.141 Mobile Safari/537.36";
const IOS_SHARE_USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

const videoIdPattern = /"video":{"play_addr":{"uri":"([a-z0-9]+)"/;
const playUrlTemplate =
  "https://www.iesdouyin.com/aweme/v1/play/?video_id=%s&ratio=1080p&line=0";

type ParseResult =
  | { type: "video"; urls: [string] }
  | { type: "images"; urls: string[] };

async function fetchText(
  url: string,
  userAgent: string,
  extraHeaders: Record<string, string> = {},
): Promise<{ finalUrl: string; text: string; headers: Headers }> {
  const headers = new Headers(extraHeaders);
  headers.set("User-Agent", userAgent);
  const resp = await fetch(url, { method: "GET", headers });
  return { finalUrl: resp.url, text: await resp.text(), headers: resp.headers };
}

function decodeUrlEscapes(url: string): string {
  return url
    .replace(/\\u002F/g, "/")
    .replace(/\\u0026/g, "&")
    .replace(/&amp;/g, "&");
}

function extractAwemeIdFromText(
  input: string,
): { id: string; hint: "video" | "note" } | null {
  const patterns = [
    { re: /\/video\/(\d+)/, hint: "video" as const },
    { re: /\/note\/(\d+)/, hint: "note" as const },
    { re: /\/slides\/(\d+)/, hint: "note" as const },
    { re: /\/share\/note\/(\d+)/, hint: "note" as const },
    { re: /item_ids=(\d+)/, hint: "note" as const },
    { re: /aweme_ids=(\d+)/, hint: "note" as const },
  ] as const;

  for (const { re, hint } of patterns) {
    const match = re.exec(input);
    if (match?.[1]) return { id: match[1], hint };
  }
  return null;
}

async function resolveAwemeId(
  url: string,
): Promise<{ id: string; hint: "video" | "note" }> {
  const direct = extractAwemeIdFromText(url);
  if (direct) return direct;

  const resp = await fetchText(url, MOBILE_USER_AGENT, { Accept: "text/html" });
  const fromFinalUrl = extractAwemeIdFromText(resp.finalUrl);
  if (fromFinalUrl) return fromFinalUrl;
  const fromBody = extractAwemeIdFromText(resp.text);
  if (fromBody) return fromBody;

  throw new Error("Aweme ID not found in URL");
}

function scoreImageUrl(url: string): number {
  let score = 0;

  if (url.startsWith("https://p3")) score += 10;

  if (/\.(jpe?g)\b/i.test(url)) score += 6;
  else if (/\.png\b/i.test(url)) score += 5;
  else if (/\.webp\b/i.test(url)) score += 4;

  const tildeIndex = url.indexOf("~");
  const queryIndex = url.indexOf("?");
  const template = tildeIndex === -1
    ? ""
    : url.slice(tildeIndex + 1, queryIndex === -1 ? undefined : queryIndex);

  if (template.includes("watermark") || url.includes("watermark")) score -= 10000;

  if (template.includes("tplv-dy-aweme-images")) score += 80;
  if (template.includes("tplv-dy-lqen-new")) score += 70;
  if (template.includes("resize")) score += 20;

  const qMatch = /:q(\d{2,3})\b/i.exec(template);
  if (qMatch?.[1]) score += Number(qMatch[1]);

  for (const match of template.matchAll(/:(\d{2,5})\b/g)) {
    score += Math.min(Number(match[1]), 2500) / 100;
  }

  try {
    const u = new URL(url);
    if (u.searchParams.get("sc") === "image") score += 1000;
    if (u.searchParams.get("biz_tag") === "aweme_images") score += 100;
  } catch {
    // ignore
  }

  return score;
}

function extractNoWatermarkImageUrlsFromHtml(html: string): string[] {
  const normalized = decodeUrlEscapes(html);
  const urlRe =
    /https?:\/\/p\d+(?:-pc)?-sign\.douyinpic\.com\/[^"\s]+/g;

  const order: string[] = [];
  const bestByKey = new Map<string, { url: string; score: number }>();

  let match: RegExpExecArray | null;
  while ((match = urlRe.exec(normalized))) {
    const url = match[0];
    if (!url.includes("/tos-cn-i-")) continue;
    if (url.includes("watermark")) continue;

    const keyMatch =
      /https?:\/\/p\d+(?:-pc)?-sign\.douyinpic\.com\/(tos-cn-i-[^/?#]+\/[^~/?#]+)/
        .exec(url);
    if (!keyMatch?.[1]) continue;

    const key = keyMatch[1];
    const score = scoreImageUrl(url);

    if (!bestByKey.has(key)) order.push(key);
    const prev = bestByKey.get(key);
    if (!prev || score > prev.score) bestByKey.set(key, { url, score });
  }

  return order.map((key) => bestByKey.get(key)!.url);
}

async function getVideoId(url: string): Promise<string> {
  const resp = await fetchText(url, MOBILE_USER_AGENT);
  const match = videoIdPattern.exec(resp.text);
  if (!match || !match[1]) throw new Error("Video ID not found in URL");
  return match[1];
}

async function getVideoUrl(url: string): Promise<string> {
  const id = await getVideoId(url);
  return playUrlTemplate.replace("%s", id);
}

async function getImageUrls(url: string): Promise<string[]> {
  const { id } = await resolveAwemeId(url);
  const shareUrl = `https://m.douyin.com/share/note/${id}`;
  const resp = await fetchText(shareUrl, IOS_SHARE_USER_AGENT, {
    Accept: "text/html",
  });
  const urls = extractNoWatermarkImageUrlsFromHtml(resp.text);
  if (urls.length === 0) throw new Error("No images found in URL");
  return urls;
}

async function getNoWatermarkUrls(url: string): Promise<ParseResult> {
  try {
    const videoUrl = await getVideoUrl(url);
    return { type: "video", urls: [videoUrl] };
  } catch {
    const imageUrls = await getImageUrls(url);
    return { type: "images", urls: imageUrls };
  }
}

export { getNoWatermarkUrls, getVideoUrl };
