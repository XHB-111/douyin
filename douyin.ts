const MOBILE_USER_AGENT =
  "Mozilla/5.0 (Linux; Android 11; SAMSUNG SM-G973U) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/14.2 Chrome/87.0.4280.141 Mobile Safari/537.36";
const DESKTOP_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

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

function extractCookieFromSetCookieHeader(
  setCookie: string | null,
  name: string,
): string | null {
  if (!setCookie) return null;
  const match = new RegExp(`${name}=([^;]+)`).exec(setCookie);
  return match?.[1] ?? null;
}

function extractAcrChallengeScript(html: string): string | null {
  const match =
    /<script>([\s\S]*?)<\/script>\s*<script>function _f1/.exec(html);
  return match?.[1] ?? null;
}

function computeAcSignature(
  challengeScript: string,
  nonce: string,
  userAgent: string,
  pageUrl: string,
): string {
  const windowObj: any = Object.create(globalThis);
  windowObj.navigator = { userAgent };
  windowObj.location = { href: pageUrl, protocol: "https:" };
  windowObj.document = { cookie: `__ac_nonce=${nonce}` };

  const bytedAcrawler = new Function(
    "window",
    "global",
    "navigator",
    "location",
    "document",
    `${challengeScript}; return window.byted_acrawler;`,
  )(windowObj, windowObj, windowObj.navigator, windowObj.location, windowObj.document);

  if (!bytedAcrawler || typeof bytedAcrawler.sign !== "function") {
    throw new Error("byted_acrawler not available");
  }

  if (typeof bytedAcrawler.init === "function") {
    bytedAcrawler.init({ aid: 99999999, dfp: 0 });
  }

  const signature = bytedAcrawler.sign("", nonce);
  if (typeof signature !== "string" || signature.length === 0) {
    throw new Error("Failed to compute __ac_signature");
  }
  return signature;
}

async function fetchDouyinHtmlBypassAcr(url: string): Promise<string> {
  const first = await fetchText(url, DESKTOP_USER_AGENT, { Accept: "text/html" });
  const nonce = extractCookieFromSetCookieHeader(
    first.headers.get("set-cookie"),
    "__ac_nonce",
  );
  const isAcrChallenge =
    first.text.includes("window.byted_acrawler") && typeof nonce === "string";

  if (!isAcrChallenge) return first.text;

  const script = extractAcrChallengeScript(first.text);
  if (!script) throw new Error("Douyin ACR challenge script not found");

  const signature = computeAcSignature(
    script,
    nonce,
    DESKTOP_USER_AGENT,
    first.finalUrl,
  );

  const cookie =
    `__ac_nonce=${nonce}; __ac_signature=${signature}; __ac_referer=__ac_blank`;
  const second = await fetchText(first.finalUrl, DESKTOP_USER_AGENT, {
    Accept: "text/html",
    Cookie: cookie,
    Referer: "https://www.douyin.com/",
  });

  return second.text;
}

function decodeUrlEscapes(url: string): string {
  return url.replace(/\\u0026/g, "&").replace(/&amp;/g, "&");
}

function extractNoWatermarkImageUrlsFromHtml(html: string): string[] {
  const patterns = [
    // URLs embedded in JSON strings, terminated by \"
    /https:\/\/p\d+(?:-pc)?-sign\.douyinpic\.com\/(tos-cn-i-[^/]+\/[^~"\s]+)~tplv-dy-aweme-images:q75\.(jpeg|webp)\?[^"<]*?(?=\\")/g,
    // Fallback: URLs in HTML attrs, terminated by "
    /https:\/\/p\d+(?:-pc)?-sign\.douyinpic\.com\/(tos-cn-i-[^/]+\/[^~"\s]+)~tplv-dy-aweme-images:q75\.(jpeg|webp)\?[^"\s]*/g,
  ] as const;

  const order: string[] = [];
  const bestByUri = new Map<string, { url: string; score: number }>();

  for (const re of patterns) {
    let match: RegExpExecArray | null;
    while ((match = re.exec(html))) {
      const uri = match[1];
      const ext = match[2];
      const rawUrl = match[0];
      const url = decodeUrlEscapes(rawUrl);

      let score = 0;
      score += ext === "jpeg" ? 10 : 5;
      if (url.startsWith("https://p3")) score += 2;

      if (!bestByUri.has(uri)) order.push(uri);
      const prev = bestByUri.get(uri);
      if (!prev || score > prev.score) bestByUri.set(uri, { url, score });
    }
  }

  const urls = order.map((uri) => bestByUri.get(uri)!.url);
  return Array.from(new Set(urls));
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
  const html = await fetchDouyinHtmlBypassAcr(url);
  const urls = extractNoWatermarkImageUrlsFromHtml(html);
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
