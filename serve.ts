import { getNoWatermarkUrls } from "./douyin.ts";

const handler = async (req: Request) => {
  console.log("Method:", req.method);

  const url = new URL(req.url);
  if (!url.searchParams.has("url")) {
    return new Response("请提供url参数", {
      status: 400,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  const inputUrl = url.searchParams.get("url")!;
  console.log("inputUrl:", inputUrl);

  try {
    const result = await getNoWatermarkUrls(inputUrl);
    return new Response(result.urls.join("\n"), {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "X-Media-Type": result.type,
      },
    });
  } catch (error) {
    console.error(error);
    const message = error instanceof Error ? error.message : String(error);
    return new Response(message, {
      status: 500,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
};

export { handler };
