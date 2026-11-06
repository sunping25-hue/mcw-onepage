import { createSign, randomBytes } from "node:crypto";

export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
export const BACKUP_FOLDER_NAME = "MCW Laundry Map Private Backups";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

function base64url(value) {
  return Buffer.from(value).toString("base64url");
}

/** RS256 JWT for a Google service account. Scope is drive.file only. */
export function signServiceAccountJwt({
  clientEmail,
  privateKey,
  now = new Date(),
  scope = DRIVE_SCOPE,
}) {
  const issued = Math.floor(now.getTime() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = base64url(
    JSON.stringify({
      iss: clientEmail,
      scope,
      aud: TOKEN_URL,
      iat: issued,
      exp: issued + 3600,
    }),
  );
  const unsigned = `${header}.${claim}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  return `${unsigned}.${signer.sign(privateKey).toString("base64url")}`;
}

export function authorizationUrl({
  clientId,
  redirectUri = "http://127.0.0.1",
}) {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", DRIVE_SCOPE);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "false");
  return url;
}

function quote(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function multipartBody(metadata, bytes) {
  const boundary = `mcw${randomBytes(12).toString("hex")}`;
  const payload = Buffer.from(bytes);
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`,
    ),
    payload,
    Buffer.from(`\r\n--${boundary}--`),
  ]);
  return { contentType: `multipart/related; boundary=${boundary}`, body };
}

export function createDriveStore({
  clientId,
  clientSecret,
  refreshToken,
  serviceAccountEmail,
  privateKey,
  parentFolderId = "",
  fetcher = fetch,
  tokenUrl = TOKEN_URL,
  apiBase = "https://www.googleapis.com/drive/v3",
  uploadBase = "https://www.googleapis.com/upload/drive/v3",
  folderName = BACKUP_FOLDER_NAME,
  now = () => new Date(),
} = {}) {
  let accessToken = "";
  let accessExpires = 0;
  let rootId = "";
  const folders = new Map();

  async function authorized(url, options = {}) {
    if (!accessToken || Date.now() > accessExpires - 60_000) {
      const form = new URLSearchParams(
        refreshToken
          ? {
              client_id: clientId,
              client_secret: clientSecret,
              refresh_token: refreshToken,
              grant_type: "refresh_token",
            }
          : {
              grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
              assertion: signServiceAccountJwt({
                clientEmail: serviceAccountEmail,
                privateKey,
                now: now(),
              }),
            },
      );
      const token = await fetcher(tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: form,
        signal: AbortSignal.timeout(20000),
      });
      if (!token.ok) throw Error(`Google 授權失敗 HTTP ${token.status}`);
      const json = await token.json();
      if (!json.access_token) throw Error("Google 授權沒有存取權杖");
      accessToken = json.access_token;
      accessExpires = Date.now() + Number(json.expires_in || 3600) * 1000;
    }
    const headers = {
      Authorization: `Bearer ${accessToken}`,
      ...(options.headers || {}),
    };
    const response = await fetcher(url, {
      ...options,
      headers,
      signal: AbortSignal.timeout(20000),
    });
    return response;
  }

  async function list(query) {
    const files = [];
    let page = "";
    do {
      const url = new URL(`${apiBase}/files`);
      url.searchParams.set("q", query);
      url.searchParams.set("fields", "nextPageToken,files(id,name,mimeType)");
      url.searchParams.set("pageSize", "100");
      url.searchParams.set("supportsAllDrives", "true");
      url.searchParams.set("includeItemsFromAllDrives", "true");
      if (page) url.searchParams.set("pageToken", page);
      const response = await authorized(url);
      if (!response.ok) throw Error(`Google Drive 清單失敗 HTTP ${response.status}`);
      const json = await response.json();
      files.push(...(json.files || []));
      page = json.nextPageToken || "";
    } while (page);
    return files;
  }

  async function createFolder(name, parent) {
    const response = await authorized(`${apiBase}/files?supportsAllDrives=true`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        mimeType: "application/vnd.google-apps.folder",
        parents: parent ? [parent] : undefined,
        description: "MCW laundry map private snapshots. Do not share publicly.",
      }),
    });
    if (!response.ok) throw Error(`Google Drive 建立資料夾失敗 HTTP ${response.status}`);
    const json = await response.json();
    if (!json.id) throw Error("Google Drive 沒有回傳資料夾編號");
    return json.id;
  }

  async function ensureFolder(name, parent) {
    const cacheKey = `${parent || "root"}/${name}`;
    if (folders.has(cacheKey)) return folders.get(cacheKey);
    const parentQuery = parent ? `'${quote(parent)}' in parents` : "'root' in parents";
    const found = await list(
      `name='${quote(name)}' and mimeType='application/vnd.google-apps.folder' and ${parentQuery} and trashed=false`,
    );
    const id = found[0]?.id || (await createFolder(name, parent));
    folders.set(cacheKey, id);
    return id;
  }

  async function rootFolder() {
    if (rootId) return rootId;
    rootId = await ensureFolder(folderName, parentFolderId || "");
    return rootId;
  }

  async function locate(key, createMissing) {
    const parts = key.split("/");
    const fileName = parts.pop();
    let parent = await rootFolder();
    for (const part of parts) {
      const cacheKey = `${parent}/${part}`;
      if (!folders.has(cacheKey)) {
        const found = await list(
          `name='${quote(part)}' and mimeType='application/vnd.google-apps.folder' and '${quote(parent)}' in parents and trashed=false`,
        );
        if (!found[0] && !createMissing) return null;
        folders.set(cacheKey, found[0]?.id || (await createFolder(part, parent)));
      }
      parent = folders.get(cacheKey);
    }
    const existing = await list(
      `name='${quote(fileName)}' and mimeType!='application/vnd.google-apps.folder' and '${quote(parent)}' in parents and trashed=false`,
    );
    return { parent, fileName, id: existing[0]?.id || "" };
  }

  return {
    scope: DRIVE_SCOPE,
    async put(key, bytes) {
      const place = await locate(key, true);
      if (place.id) {
        const response = await authorized(
          `${uploadBase}/files/${place.id}?uploadType=media&supportsAllDrives=true`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/octet-stream" },
            body: Buffer.from(bytes),
          },
        );
        if (!response.ok) throw Error(`Google Drive 更新失敗 HTTP ${response.status}`);
        return;
      }
      const payload = multipartBody(
        {
          name: place.fileName,
          parents: [place.parent],
          description: "MCW laundry map private snapshot. Do not share publicly.",
        },
        bytes,
      );
      const response = await authorized(
        `${uploadBase}/files?uploadType=multipart&supportsAllDrives=true&fields=id`,
        {
          method: "POST",
          headers: { "Content-Type": payload.contentType },
          body: payload.body,
        },
      );
      if (!response.ok) throw Error(`Google Drive 上傳失敗 HTTP ${response.status}`);
    },
    async get(key) {
      const place = await locate(key, false);
      if (!place?.id) return null;
      const response = await authorized(
        `${apiBase}/files/${place.id}?alt=media&supportsAllDrives=true`,
      );
      if (response.status === 404) return null;
      if (!response.ok) throw Error(`Google Drive 讀取失敗 HTTP ${response.status}`);
      return Buffer.from(await response.arrayBuffer());
    },
  };
}

export function driveConfigFromEnv(env = process.env) {
  const present = (name) => String(env[name] || "").trim();
  const oauth = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REFRESH_TOKEN"];
  const service = ["GOOGLE_SERVICE_ACCOUNT_EMAIL", "GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY"];
  const oauthReady = oauth.every((name) => present(name));
  const serviceReady = service.every((name) => present(name));
  if (!oauthReady && !serviceReady) {
    const started = oauth.some((name) => present(name))
      ? oauth
      : service.some((name) => present(name))
        ? service
        : oauth;
    return {
      configured: false,
      missing: started.filter((name) => !present(name)),
    };
  }
  return {
    configured: true,
    missing: [],
    options: oauthReady
      ? {
          clientId: present("GOOGLE_CLIENT_ID"),
          clientSecret: present("GOOGLE_CLIENT_SECRET"),
          refreshToken: present("GOOGLE_REFRESH_TOKEN"),
          parentFolderId: present("GOOGLE_DRIVE_FOLDER_ID"),
        }
      : {
          serviceAccountEmail: present("GOOGLE_SERVICE_ACCOUNT_EMAIL"),
          privateKey: present("GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY").replace(/\\n/g, "\n"),
          parentFolderId: present("GOOGLE_DRIVE_FOLDER_ID"),
        },
  };
}
