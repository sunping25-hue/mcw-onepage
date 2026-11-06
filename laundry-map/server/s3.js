import { createHash, createHmac } from "node:crypto";

function encodeRfc3986(value) {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function canonicalUri(pathname) {
  const encoded = pathname
    .split("/")
    .map((segment, index) =>
      index === 0 ? "" : encodeRfc3986(decodeURIComponent(segment)),
    )
    .join("/");
  return encoded || "/";
}

function canonicalQuery(url) {
  return [...url.searchParams.entries()]
    .map(([key, value]) => [encodeRfc3986(key), encodeRfc3986(value)])
    .sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : 1) : a[0] < b[0] ? -1 : 1))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
}

/** AWS Signature Version 4 for a single S3-compatible request. */
export function authorizationHeaders({
  method,
  url,
  body = Buffer.alloc(0),
  accessKeyId,
  secretAccessKey,
  region,
  now = new Date(),
  extraHeaders = {},
}) {
  const payload = Buffer.isBuffer(body) ? body : Buffer.from(body);
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = createHash("sha256").update(payload).digest("hex");
  const headers = {
    host: url.host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
  };
  for (const [key, value] of Object.entries(extraHeaders)) {
    headers[key.toLowerCase()] = String(value).trim().replace(/\s+/g, " ");
  }
  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map((name) => `${name}:${headers[name]}\n`).join("");
  const signedHeaders = names.join(";");
  const canonicalRequest = [
    method.toUpperCase(),
    canonicalUri(url.pathname),
    canonicalQuery(url),
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");
  const scope = `${dateStamp}/${region}/s3/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    createHash("sha256").update(canonicalRequest).digest("hex"),
  ].join("\n");
  let key = `AWS4${secretAccessKey}`;
  for (const part of [dateStamp, region, "s3", "aws4_request"]) {
    key = createHmac("sha256", key).update(part).digest();
  }
  const signature = createHmac("sha256", key).update(stringToSign).digest("hex");
  return {
    ...headers,
    Authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}

export async function s3Request({
  method,
  endpoint,
  bucket,
  key,
  body = Buffer.alloc(0),
  accessKeyId,
  secretAccessKey,
  region = "auto",
  timeoutMs = 20000,
  fetcher = fetch,
}) {
  const payload = Buffer.isBuffer(body) ? body : Buffer.from(body);
  const base = new URL(endpoint);
  const pathname = canonicalUri(`/${bucket}/${key}`);
  const url = new URL(base.origin);
  url.pathname = pathname;
  const signed = authorizationHeaders({
    method,
    url,
    body: payload,
    accessKeyId,
    secretAccessKey,
    region,
    extraHeaders:
      method === "GET" || method === "HEAD"
        ? {}
        : { "content-length": String(payload.length) },
  });
  const { host, ...headers } = signed;
  return fetcher(url, {
    method,
    headers,
    body: method === "GET" || method === "HEAD" ? undefined : payload,
    redirect: "error",
    signal: AbortSignal.timeout(timeoutMs),
  });
}
