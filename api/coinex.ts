import https from "node:https";

const COINEX_BASE_URL = "https://api.coinex.com/v1";

const setCorsHeaders = (res: any) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept, Origin, X-Requested-With");
  res.setHeader("Access-Control-Max-Age", "86400");
};

const readQueryValue = (value: string | string[] | undefined) => {
  if (!value) return undefined;
  return Array.isArray(value) ? value[0] : value;
};

const getQueryParams = (req: any): Record<string, string | string[]> => {
  if (req?.query && typeof req.query === "object") {
    return req.query;
  }

  if (!req?.url) {
    return {};
  }

  const baseUrl = `http://${req.headers?.host ?? "localhost"}`;
  const parsedUrl = new URL(req.url, baseUrl);
  const params: Record<string, string> = {};

  parsedUrl.searchParams.forEach((value, key) => {
    if (!(key in params)) {
      params[key] = value;
    }
  });

  return params;
};

export default async function handler(req: any, res: any) {
  setCorsHeaders(res);

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed." });
    return;
  }

  const queryParams = getQueryParams(req);
  const path = readQueryValue(queryParams.path);

  if (!path) {
    res.status(400).json({ error: "Missing 'path' query parameter." });
    return;
  }

  if (path.startsWith("http://") || path.startsWith("https://")) {
    res.status(400).json({ error: "Path must be relative to the CoinEx API." });
    return;
  }

  let targetUrl: URL;
  try {
    targetUrl = new URL(`${COINEX_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`);
  } catch (error) {
    console.error("Invalid CoinEx proxy URL:", error);
    res.status(400).json({ error: "Invalid 'path' query parameter." });
    return;
  }
  Object.entries(queryParams).forEach(([key, value]) => {
    if (key === "path") return;
    const normalized = readQueryValue(value as string | string[] | undefined);
    if (normalized !== undefined) {
      targetUrl.searchParams.set(key, normalized);
    }
  });

  try {
    const { statusCode, body, contentType } = await fetchCoinex(targetUrl);
    if (contentType) {
      res.setHeader("Content-Type", contentType);
    }
    res.status(statusCode).send(body);
  } catch (error) {
    console.error("CoinEx proxy error:", error);
    res.status(502).json({ error: "Failed to reach CoinEx API." });
  }
}

const fetchCoinex = (url: URL) =>
  new Promise<{ statusCode: number; body: string; contentType?: string }>((resolve, reject) => {
    const request = https.request(
      url,
      {
        method: "GET",
        headers: {
          Accept: "application/json",
          "User-Agent": "QuantMind-Vercel-Proxy",
        },
      },
      response => {
        const chunks: Buffer[] = [];

        response.on("data", chunk => {
          chunks.push(chunk);
        });

        response.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf-8");
          resolve({
            statusCode: response.statusCode ?? 502,
            body,
            contentType: response.headers["content-type"],
          });
        });
      }
    );

    request.on("error", reject);
    request.end();
  });
