import { COINEX_BASE_URL } from "../constants";

const setCorsHeaders = (res: any) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
};

const readQueryValue = (value: string | string[] | undefined) => {
  if (!value) return undefined;
  return Array.isArray(value) ? value[0] : value;
};

export default async function handler(req: any, res: any) {
  setCorsHeaders(res);

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  const path = readQueryValue(req.query?.path);

  if (!path) {
    res.status(400).json({ error: "Missing 'path' query parameter." });
    return;
  }

  const targetUrl = new URL(`${COINEX_BASE_URL}${path}`);
  const queryParams = req.query ?? {};

  Object.entries(queryParams).forEach(([key, value]) => {
    if (key === "path") return;
    const normalized = readQueryValue(value as string | string[] | undefined);
    if (normalized !== undefined) {
      targetUrl.searchParams.set(key, normalized);
    }
  });

  try {
    const response = await fetch(targetUrl.toString(), {
      headers: {
        Accept: "application/json",
      },
    });

    const body = await response.text();
    res.status(response.status).send(body);
  } catch (error) {
    res.status(502).json({ error: "Failed to reach CoinEx API." });
  }
}
