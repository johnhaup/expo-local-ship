import chalk from "chalk";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import type { ScreenshotsConfig, ShipConfig } from "./config";
import { PLAY_FEATURE_GRAPHIC, PLAY_ICON } from "./frame";

const BASE_URL = "https://androidpublisher.googleapis.com/androidpublisher/v3/applications";

// App Store locale codes that Play spells differently. Anything not listed is sent as is.
const PLAY_LOCALES: Record<string, string> = {
  "ar-SA": "ar",
  cs: "cs-CZ",
  da: "da-DK",
  el: "el-GR",
  "es-MX": "es-419",
  fi: "fi-FI",
  he: "iw-IL",
  hi: "hi-IN",
  hu: "hu-HU",
  it: "it-IT",
  ja: "ja-JP",
  ko: "ko-KR",
  no: "no-NO",
  pl: "pl-PL",
  ru: "ru-RU",
  "sl-SI": "sl",
  sv: "sv-SE",
  tr: "tr-TR",
  "ur-PK": "ur",
  "zh-Hans": "zh-CN",
  "zh-Hant": "zh-TW",
  "gu-IN": "gu",
  "pa-IN": "pa",
  "or-IN": "or",
};

interface ServiceAccount {
  client_email: string;
  private_key: string;
  token_uri: string;
}

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

/** The service account key eas submit already uses, from eas.json */
function serviceAccount(cwd: string): ServiceAccount {
  const eas = readJson<{ submit?: { production?: { android?: { serviceAccountKeyPath?: string } } } }>(
    path.join(cwd, "eas.json")
  );
  const keyPath = eas.submit?.production?.android?.serviceAccountKeyPath;
  if (!keyPath) throw new Error("No submit.production.android.serviceAccountKeyPath in eas.json");
  const file = path.resolve(cwd, keyPath);
  if (!fs.existsSync(file)) throw new Error(`Service account key not found at ${file}`);
  return readJson(file);
}

async function accessToken(account: ServiceAccount): Promise<string> {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    iss: account.client_email,
    scope: "https://www.googleapis.com/auth/androidpublisher",
    aud: account.token_uri,
    iat: now,
    exp: now + 3600,
  };
  const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64(claims)}`;
  const signature = crypto.sign("sha256", Buffer.from(unsigned), account.private_key).toString("base64url");
  const response = await fetch(account.token_uri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${unsigned}.${signature}`,
    }),
  });
  const json = await response.json();
  if (!json.access_token) throw new Error(`Google token request failed: ${json.error_description ?? json.error}`);
  return json.access_token;
}

class PlayError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

/** One Play "edit": changes are staged and only go live together on commit */
class PlayEdit {
  private constructor(
    private readonly base: string,
    private readonly token: string,
    readonly id: string
  ) {}

  static async open(cwd: string, packageName: string): Promise<PlayEdit> {
    const token = await accessToken(serviceAccount(cwd));
    const base = `${BASE_URL}/${packageName}/edits`;
    const edit = await request<{ id: string }>(token, "POST", base);
    return new PlayEdit(base, token, edit.id);
  }

  request<T>(method: string, route: string, body?: object): Promise<T> {
    return request(this.token, method, `${this.base}/${this.id}${route}`, body);
  }

  /** Images go to the separate upload endpoint as the raw file body */
  upload(route: string, file: string): Promise<unknown> {
    const base = this.base.replace("/androidpublisher/v3/", "/upload/androidpublisher/v3/");
    return request(this.token, "POST", `${base}/${this.id}${route}?uploadType=media`, fs.readFileSync(file));
  }

  async commit(): Promise<void> {
    try {
      await this.request("POST", ":commit");
    } catch (error) {
      // Apps with changes under review refuse a plain commit and ask for this flag instead
      if (!(error instanceof PlayError) || !/changesNotSentForReview/.test(error.message)) throw error;
      await this.request("POST", ":commit?changesNotSentForReview=true");
    }
  }
}

async function request<T>(token: string, method: string, url: string, body?: object | Buffer): Promise<T> {
  const image = Buffer.isBuffer(body);
  const response = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": image ? "image/png" : "application/json" },
    body: image ? new Uint8Array(body) : body && JSON.stringify(body),
  });
  const json = response.status === 204 ? {} : await response.json();
  if (!response.ok) {
    throw new PlayError(`Google Play ${method} ${url.replace(BASE_URL, "")} failed (${response.status}): ${json.error?.message}`, response.status);
  }
  return json;
}

function requirePackage(config: ShipConfig): string {
  if (!config.androidPackage) throw new Error("No Android package: set android.package in app.json");
  return config.androidPackage;
}

/**
 * Pushes the store listing for every locale plus contact details. Play has no subtitle or
 * keywords, so the subtitle becomes the 80-character short description.
 */
export async function pushPlayMetadata(config: ShipConfig): Promise<void> {
  const packageName = requirePackage(config);
  console.log(chalk.blue(`\n🤖 Google Play listing · ${packageName}`));
  const edit = await PlayEdit.open(config.cwd, packageName);

  await edit.request("PATCH", "/details", {
    defaultLanguage: config.locale,
    contactWebsite: config.listing.marketingUrl ?? config.listing.supportUrl,
    ...(config.googlePlay?.contactEmail && { contactEmail: config.googlePlay.contactEmail }),
  });

  const locales: [string, ShipConfig["localizations"][string]][] = [
    [config.locale, {}],
    ...Object.entries(config.localizations),
  ];
  const skipped: string[] = [];
  for (const [locale, localized] of locales) {
    const language = PLAY_LOCALES[locale] ?? locale;
    const listing = {
      language,
      title: localized.name ?? config.listing.name,
      shortDescription: localized.subtitle ?? config.listing.subtitle ?? "",
      fullDescription: localized.description ?? config.listing.description,
    };
    try {
      await edit.request("PUT", `/listings/${language}`, listing);
      console.log(chalk.dim(`  ✓ ${language}`));
    } catch (error) {
      // Play supports fewer languages than the App Store; skip those rather than fail the batch
      if (!(error instanceof PlayError) || error.status !== 400) throw error;
      skipped.push(`${locale} (${language}): ${error.message.split("): ").pop()}`);
    }
  }

  await edit.commit();
  console.log(chalk.green(`  ✓ ${locales.length - skipped.length} listings committed`));
  for (const line of skipped) console.log(chalk.yellow(`  ⚠ skipped ${line}`));
}

/**
 * Replaces the phone screenshots in every framed locale, plus the icon and feature graphic on the
 * default listing (other languages fall back to it). Expects "screenshots frame --android" output.
 */
export async function uploadPlayImages(config: ShipConfig, screenshots: ScreenshotsConfig): Promise<void> {
  const packageName = requirePackage(config);
  const framedRoot = path.join(screenshots.dir, "framed");
  if (!fs.existsSync(path.join(framedRoot, config.locale))) {
    throw new Error(`No framed screenshots in ${framedRoot}. Run "screenshots frame --android" first.`);
  }
  console.log(chalk.blue(`\n🖼  Google Play images · ${packageName}`));
  const edit = await PlayEdit.open(config.cwd, packageName);

  const defaultLanguage = PLAY_LOCALES[config.locale] ?? config.locale;
  for (const [type, file] of [["icon", PLAY_ICON], ["featureGraphic", PLAY_FEATURE_GRAPHIC]]) {
    const image = path.join(screenshots.dir, file);
    if (!fs.existsSync(image)) throw new Error(`Missing ${image}. Run "screenshots frame --android" first.`);
    await edit.request("DELETE", `/listings/${defaultLanguage}/${type}`);
    await edit.upload(`/listings/${defaultLanguage}/${type}`, image);
  }
  console.log(chalk.dim(`  ✓ icon and feature graphic (${defaultLanguage})`));

  const skipped: string[] = [];
  for (const locale of fs.readdirSync(framedRoot).sort()) {
    const language = PLAY_LOCALES[locale] ?? locale;
    const shots = fs.readdirSync(path.join(framedRoot, locale)).filter((f) => f.endsWith(".png")).sort();
    try {
      await edit.request("DELETE", `/listings/${language}/phoneScreenshots`);
    } catch (error) {
      // No listing in this language (Play doesn't support it, or metadata hasn't been pushed)
      if (!(error instanceof PlayError) || ![400, 404].includes(error.status)) throw error;
      skipped.push(`${locale} (${language})`);
      continue;
    }
    for (const shot of shots) await edit.upload(`/listings/${language}/phoneScreenshots`, path.join(framedRoot, locale, shot));
    console.log(chalk.dim(`  ✓ ${language}: ${shots.length}`));
  }

  await edit.commit();
  console.log(chalk.green("  ✓ Images committed"));
  if (skipped.length) console.log(chalk.yellow(`  ⚠ skipped ${skipped.join(", ")}`));
}
