import { input } from "@inquirer/prompts";
import chalk from "chalk";
import fs from "fs";
import os from "os";
import path from "path";
import { run } from "../exec";
import { loadAscConfig } from "../submit";
import type { ShipConfig } from "./config";
import { requireScreenshots } from "./config";

export function apiKeyPath(keyId: string): string {
  return path.join(os.homedir(), ".appstoreconnect", "private_keys", `AuthKey_${keyId}.p8`);
}

function withTempDir<T>(prefix: string, fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return fn(dir).finally(() => fs.rmSync(dir, { recursive: true, force: true }));
}

/** fastlane reads the API key from a JSON file; it only lives for the duration of the call */
function withApiKey<T>(fn: (keyFile: string) => Promise<T>): Promise<T> {
  const { apiKey, apiIssuer } = loadAscConfig();
  const p8 = apiKeyPath(apiKey);
  if (!fs.existsSync(p8)) throw new Error(`API key not found at ${p8}. Run "expo-local-ship setup".`);

  return withTempDir("ship-key-", async (dir) => {
    const keyFile = path.join(dir, "api_key.json");
    const json = { key_id: apiKey, issuer_id: apiIssuer, key: fs.readFileSync(p8, "utf8"), duration: 1200, in_house: false };
    fs.writeFileSync(keyFile, JSON.stringify(json), { mode: 0o600 });
    return fn(keyFile);
  });
}

function deliver(config: ShipConfig, keyFile: string, args: string[], env?: NodeJS.ProcessEnv): Promise<void> {
  // Without a Deliverfile in the working directory, deliver stops to offer its setup wizard
  return withTempDir("ship-deliver-", (cwd) => {
    fs.writeFileSync(path.join(cwd, "Deliverfile"), "");
    return run(
      "fastlane",
      [
        "deliver",
        "--api_key_path", keyFile,
        "--app_identifier", config.bundleId,
        "--app_version", config.version,
        "--platform", "ios",
        "--skip_binary_upload", "true",
        "--run_precheck_before_submit", "false",
        "--force", "true",
        ...(process.env.SHIP_VERBOSE ? ["--verbose"] : []),
        ...args,
      ],
      { cwd, env: { FASTLANE_SKIP_UPDATE_CHECK: "1", FASTLANE_HIDE_CHANGELOG: "1", ...env } }
    );
  });
}

function writeMetadata(config: ShipConfig, dir: string): void {
  const write = (file: string, value: string | undefined) => {
    if (value === undefined) return;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, value.trim() + "\n");
  };
  const { listing, review } = config;
  const locales = { [config.locale]: {}, ...config.localizations };

  for (const [locale, localized] of Object.entries(locales)) {
    const text = { ...listing, ...localized };
    const localeDir = path.join(dir, locale);
    write(path.join(localeDir, "name.txt"), text.name);
    write(path.join(localeDir, "subtitle.txt"), text.subtitle);
    write(path.join(localeDir, "description.txt"), text.description);
    write(path.join(localeDir, "keywords.txt"), text.keywords);
    write(path.join(localeDir, "promotional_text.txt"), text.promotionalText);
    write(path.join(localeDir, "release_notes.txt"), text.releaseNotes);
    write(path.join(localeDir, "support_url.txt"), listing.supportUrl);
    write(path.join(localeDir, "marketing_url.txt"), listing.marketingUrl);
    write(path.join(localeDir, "privacy_url.txt"), listing.privacyUrl);
  }
  write(path.join(dir, "copyright.txt"), listing.copyright);
  write(path.join(dir, "primary_category.txt"), listing.primaryCategory);
  write(path.join(dir, "secondary_category.txt"), listing.secondaryCategory);

  const reviewDir = path.join(dir, "review_information");
  write(path.join(reviewDir, "first_name.txt"), review?.firstName);
  write(path.join(reviewDir, "last_name.txt"), review?.lastName);
  write(path.join(reviewDir, "phone_number.txt"), review?.phone);
  write(path.join(reviewDir, "email_address.txt"), review?.email);
  write(path.join(reviewDir, "notes.txt"), review?.notes);
}

export function pushMetadata(config: ShipConfig): Promise<void> {
  const count = Object.keys(config.localizations).length + 1;
  console.log(chalk.blue(`\n📝 Uploading listing metadata (${count} ${count === 1 ? "locale" : "locales"})`));
  return withApiKey((keyFile) =>
    withTempDir("ship-metadata-", async (dir) => {
      const metadataDir = path.join(dir, "metadata");
      writeMetadata(config, metadataDir);
      const args = ["--metadata_path", metadataDir, "--skip_screenshots", "true"];
      if (config.ageRating) {
        const ratingFile = path.join(dir, "age_rating.json");
        fs.writeFileSync(ratingFile, JSON.stringify(config.ageRating));
        args.push("--app_rating_config_path", ratingFile);
      }
      await deliver(config, keyFile, args);
      console.log(chalk.green("  ✓ Metadata uploaded"));
    })
  );
}

export function uploadScreenshots(config: ShipConfig): Promise<void> {
  const screenshots = requireScreenshots(config);
  const framedRoot = path.join(screenshots.dir, "framed");
  if (!fs.existsSync(path.join(framedRoot, config.locale))) {
    throw new Error(`No framed screenshots in ${framedRoot}. Run "screenshots frame" first.`);
  }

  console.log(chalk.blue("\n🖼  Uploading screenshots"));
  return withApiKey(async (keyFile) => {
    await deliver(
      config,
      keyFile,
      ["--skip_metadata", "true", "--screenshots_path", framedRoot, "--sync_screenshots", "true"],
      { FASTLANE_ENABLE_BETA_DELIVER_SYNC_SCREENSHOTS: "true" }
    );
    console.log(chalk.green("  ✓ Screenshots synced"));
  });
}

export function submitForReview(
  config: ShipConfig,
  { buildNumber, autoRelease }: { buildNumber?: string; autoRelease: boolean }
): Promise<void> {
  console.log(chalk.blue(`\n🧑‍⚖️ Submitting ${config.version} (${buildNumber ?? "latest build"}) for review`));
  return withApiKey(async (keyFile) => {
    await deliver(config, keyFile, [
      "--skip_metadata", "true",
      "--skip_screenshots", "true",
      "--submit_for_review", "true",
      "--automatic_release", String(autoRelease),
      "--submission_information", JSON.stringify({ add_id_info_uses_idfa: false }),
      ...(buildNumber ? ["--build_number", buildNumber] : []),
    ]);
    console.log(chalk.green("  ✓ Submitted for review"));
  });
}

async function promptAppleId(): Promise<string> {
  if (process.env.APPLE_ID) return process.env.APPLE_ID;
  return input({ message: "Apple ID (email)", validate: (v) => v.includes("@") || "Enter your Apple ID email" });
}

/** Apple's API keys can't create apps, so this signs in with an Apple ID */
export async function createApp(config: ShipConfig): Promise<void> {
  console.log(chalk.blue(`\n🆕 Creating ${config.listing.name} (${config.bundleId}) in App Store Connect`));
  console.log(chalk.dim("  Signs in with your Apple ID; fastlane asks for the password and 2FA code.\n"));
  const appleId = await promptAppleId();
  await run(
    "fastlane",
    [
      "produce",
      "--username", appleId,
      "--app_identifier", config.bundleId,
      "--app_name", config.listing.name,
      "--app_version", config.version,
      "--sku", config.bundleId,
      "--language", "en-US",
    ],
    { cwd: config.cwd, env: { FASTLANE_SKIP_UPDATE_CHECK: "1" } }
  );
  console.log(chalk.green("  ✓ App exists in App Store Connect"));
}

/** App privacy answers are also Apple ID only */
export async function uploadPrivacy(config: ShipConfig): Promise<void> {
  if (!config.privacy) throw new Error('ship.config.json has no "privacy" section');
  console.log(chalk.blue("\n🔒 Uploading App Privacy answers"));
  console.log(chalk.dim("  Signs in with your Apple ID; fastlane asks for the password and 2FA code.\n"));
  const appleId = await promptAppleId();
  await withTempDir("ship-privacy-", async (dir) => {
    const jsonPath = path.join(dir, "privacy.json");
    fs.writeFileSync(jsonPath, JSON.stringify(config.privacy));
    await run(
      "fastlane",
      ["run", "upload_app_privacy_details_to_app_store", `username:${appleId}`, `app_identifier:${config.bundleId}`, `json_path:${jsonPath}`],
      { cwd: config.cwd, env: { FASTLANE_SKIP_UPDATE_CHECK: "1" } }
    );
  });
  console.log(chalk.green("  ✓ App Privacy published"));
}
