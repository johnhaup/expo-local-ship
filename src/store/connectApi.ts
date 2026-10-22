import crypto from "crypto";
import fs from "fs";
import { loadAscConfig } from "../submit";
import { apiKeyPath } from "./appstore";

const BASE_URL = "https://api.appstoreconnect.apple.com";

function token(): string {
  const { apiKey, apiIssuer } = loadAscConfig();
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64({ alg: "ES256", kid: apiKey, typ: "JWT" })}.${b64({ iss: apiIssuer, iat: now, exp: now + 600, aud: "appstoreconnect-v1" })}`;
  const signature = crypto
    .sign("sha256", Buffer.from(unsigned), { key: fs.readFileSync(apiKeyPath(apiKey), "utf8"), dsaEncoding: "ieee-p1363" })
    .toString("base64url");
  return `${unsigned}.${signature}`;
}

async function request<T>(method: string, route: string, body?: object): Promise<T> {
  const response = await fetch(`${BASE_URL}${route}`, {
    method,
    headers: { Authorization: `Bearer ${token()}`, "Content-Type": "application/json" },
    body: body && JSON.stringify(body),
  });
  const json = await response.json();
  if (!response.ok) {
    const detail = json.errors?.map((e: { title: string; detail?: string }) => e.detail ?? e.title).join("; ");
    throw new Error(`App Store Connect ${method} ${route} failed (${response.status}): ${detail}`);
  }
  return json;
}

/** Answers "Does your app contain, show, or access third-party content?", which review requires and deliver can't set */
export async function setContentRights(bundleId: string, usesThirdPartyContent: boolean): Promise<void> {
  const apps = await request<{ data: { id: string }[] }>("GET", `/v1/apps?filter[bundleId]=${encodeURIComponent(bundleId)}`);
  const app = apps.data[0];
  if (!app) throw new Error(`No App Store Connect app with bundle id ${bundleId}`);
  await request("PATCH", `/v1/apps/${app.id}`, {
    data: {
      type: "apps",
      id: app.id,
      attributes: {
        contentRightsDeclaration: usesThirdPartyContent ? "USES_THIRD_PARTY_CONTENT" : "DOES_NOT_USE_THIRD_PARTY_CONTENT",
      },
    },
  });
}
