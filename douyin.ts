const pattern = /"video":{"play_addr":{"uri":"([a-z0-9]+)"/;
const cVUrl =
  "https://www.iesdouyin.com/aweme/v1/play/?video_id=%s&ratio=1080p&line=0";

async function doGet(url: string): Promise<Response> {
  const headers = new Headers();
  headers.set(
    "User-Agent",
    "Mozilla/5.0 (Linux; Android 11; SAMSUNG SM-G973U) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/14.2 Chrome/87.0.4280.141 Mobile Safari/537.36",
  );
  const resp = await fetch(url, { method: "GET", headers });
  return resp;
}

async function getVideoId(url: string): Promise<string> {
  const resp = await doGet(url);
  const body = await resp.text();
  const match = pattern.exec(body);
  if (!match || !match[1]) throw new Error("Video ID not found in URL");
  return match[1];
}

async function getVideoUrl(url: string): Promise<string> {
  const id = await getVideoId(url);
  const downloadUrl = cVUrl.replace("%s", id);
  return downloadUrl;
}

//const url = "https://v.douyin.com/JyCk5gy";
//const downloadUrl = await getVideoUrl(url);
//console.log(downloadUrl);

export { getVideoUrl };
