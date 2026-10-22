import chalk from "chalk";
import fs from "fs";
import os from "os";
import path from "path";
import { capture, commandExists } from "../exec";
import { apiKeyPath } from "./appstore";
import { CONFIG_FILE, loadShipConfig } from "./config";

// 2.241 is the first release that accepts 1320x2868 (6.9") screenshots
const MIN_FASTLANE = [2, 241, 0];

function versionAtLeast(version: string, min: number[]): boolean {
  const parts = version.split(".").map(Number);
  for (const [i, want] of min.entries()) {
    if ((parts[i] ?? 0) !== want) return (parts[i] ?? 0) > want;
  }
  return true;
}

export async function runDoctor(cwd: string): Promise<void> {
  let ok = true;
  const check = (pass: boolean, label: string, fix?: string) => {
    ok &&= pass;
    console.log(pass ? chalk.green(`  ✓ ${label}`) : chalk.red(`  ✗ ${label}${fix ? chalk.dim(` — ${fix}`) : ""}`));
  };

  for (const [cmd, fix] of [
    ["magick", "brew install imagemagick"],
    ["rsvg-convert", "brew install librsvg"],
    ["maestro", "curl -fsSL https://get.maestro.mobile.dev | bash"],
    ["xcrun", "install Xcode"],
  ]) {
    check(await commandExists(cmd), cmd, fix);
  }

  const hasFastlane = await commandExists("fastlane");
  const fastlaneVersion = hasFastlane
    ? (await capture("fastlane", ["--version"])).match(/fastlane (\d+\.\d+\.\d+)/)?.[1] ?? "unknown"
    : undefined;
  check(
    !!fastlaneVersion && versionAtLeast(fastlaneVersion, MIN_FASTLANE),
    `fastlane ${fastlaneVersion ?? "missing"} (need ≥ ${MIN_FASTLANE.join(".")})`,
    "brew upgrade fastlane"
  );

  const configPath = path.join(os.homedir(), ".expo-local-ship.json");
  const ascConfig = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, "utf8")) : undefined;
  const keyId = process.env.ASC_API_KEY ?? ascConfig?.apiKey;
  check(!!keyId, "App Store Connect API key configured", 'run "expo-local-ship setup"');
  if (keyId) check(fs.existsSync(apiKeyPath(keyId)), `AuthKey_${keyId}.p8 present`, 'run "expo-local-ship setup"');

  try {
    const config = loadShipConfig(cwd);
    check(true, `${CONFIG_FILE} (${config.bundleId} ${config.version})`);
    const { listing, screenshots } = config;
    check(!!listing.privacyUrl, "listing.privacyUrl set", "required before review");
    check(!!listing.supportUrl, "listing.supportUrl set", "required before review");
    if (screenshots) {
      check(fs.existsSync(screenshots.flow), `Maestro flow ${path.relative(cwd, screenshots.flow)}`);
      check(fs.existsSync(screenshots.bezel), "bezel image found", screenshots.bezel);
      if (screenshots.poster) check(fs.existsSync(screenshots.poster.icon), "poster icon found", screenshots.poster.icon);
    }
  } catch (err) {
    check(false, CONFIG_FILE, err instanceof Error ? err.message : String(err));
  }

  console.log(ok ? chalk.bold.green("\n  ✅ Ready\n") : chalk.yellow("\n  ⚠  Fix the items above\n"));
  if (!ok) process.exitCode = 1;
}
