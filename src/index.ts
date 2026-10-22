import { select } from "@inquirer/prompts";
import chalk from "chalk";
import { buildPlatform, type Platform } from "./build";
import { runSetup } from "./setup";
import { openTransporter, submitAltool, submitEas } from "./submit";
import { validate } from "./validate";
import { createApp, pushMetadata, submitForReview, uploadPrivacy, uploadScreenshots } from "./store/appstore";
import { captureScreenshots } from "./store/capture";
import { loadShipConfig, requireScreenshots } from "./store/config";
import { runDoctor } from "./store/doctor";
import { frameScreenshots } from "./store/frame";
import { translateListing } from "./store/translate";

const STORE_COMMANDS = ["screenshots", "metadata", "translate", "review", "create", "privacy", "doctor"] as const;
type StoreCommand = (typeof STORE_COMMANDS)[number];
const SCREENSHOT_STEPS = ["capture", "frame", "upload", "all"];

function isStoreCommand(value: string | undefined): value is StoreCommand {
  return STORE_COMMANDS.some((c) => c === value);
}

function flagValue(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

async function runStoreCommand(command: StoreCommand, args: string[]): Promise<void> {
  const cwd = process.cwd();
  if (command === "doctor") {
    await runDoctor(cwd);
    return;
  }

  const config = loadShipConfig(cwd);
  console.log(chalk.dim(`  ${config.listing.name} · ${config.bundleId} · ${config.version}`));

  switch (command) {
    case "screenshots": {
      const step = args.find((a) => !a.startsWith("--")) ?? "all";
      if (!SCREENSHOT_STEPS.includes(step)) {
        throw new Error(`Unknown step "${step}". Use capture, frame, upload, or omit for capture + frame.`);
      }
      const screenshots = requireScreenshots(config);
      if (step === "capture" || step === "all") {
        await captureScreenshots(config, screenshots, { build: args.includes("--build") });
      }
      if (step === "frame" || step === "all") {
        console.log(chalk.blue("\n🖼  Framing"));
        await frameScreenshots(config, screenshots, { only: flagValue(args, "--locales")?.split(",") });
      }
      if (step === "upload") await uploadScreenshots(config);
      break;
    }
    case "metadata":
      await pushMetadata(config);
      break;
    case "translate":
      await translateListing(config, {
        force: args.includes("--force"),
        only: flagValue(args, "--locales")?.split(","),
      });
      break;
    case "review":
      await submitForReview(config, {
        buildNumber: flagValue(args, "--build"),
        autoRelease: args.includes("--auto-release"),
      });
      break;
    case "create":
      await createApp(config);
      break;
    case "privacy":
      await uploadPrivacy(config);
      break;
  }
}

const VALID_PLATFORMS = ["ios", "android", "both"] as const;
type PlatformArg = (typeof VALID_PLATFORMS)[number];

function parseArgs(): { platformArg: PlatformArg | undefined; noSubmit: boolean; useTransporter: boolean; setup: boolean } {
  const args = process.argv.slice(2);
  const setup = args.includes("setup");
  const noSubmit = args.includes("--no-submit");
  const useTransporter = args.includes("--transporter");
  const platformArg = args.find((a): a is PlatformArg =>
    VALID_PLATFORMS.includes(a as PlatformArg)
  );
  return { platformArg, noSubmit, useTransporter, setup };
}

async function resolvePlatform(
  platformArg: PlatformArg | undefined,
  hasIos: boolean,
  hasAndroid: boolean
): Promise<PlatformArg> {
  if (platformArg) return platformArg;

  const bothAvailable = !hasIos && !hasAndroid;
  return select({
    message: "Platform",
    choices: [
      ...(hasIos || bothAvailable ? [{ name: "iOS", value: "ios" as const }] : []),
      ...(hasAndroid || bothAvailable ? [{ name: "Android", value: "android" as const }] : []),
      { name: "Both", value: "both" as const },
    ],
  });
}

async function main() {
  const cwd = process.cwd();
  console.log(chalk.bold("\n  expo-local-ship 🚢\n"));

  const [command, ...rest] = process.argv.slice(2);
  if (isStoreCommand(command)) {
    await runStoreCommand(command, rest);
    if (!process.exitCode) console.log(chalk.bold.green("\n  ✅ All done!\n"));
    return;
  }

  const { platformArg, noSubmit, useTransporter, setup } = parseArgs();

  if (setup) {
    await runSetup();
    return;
  }

  const project = validate(cwd);
  console.log(chalk.dim(`  Project: ${project.name}`));
  if (noSubmit) console.log(chalk.dim("  Mode: build only (--no-submit)\n"));
  else if (useTransporter) console.log(chalk.dim("  Mode: build + Transporter (--transporter)\n"));
  else console.log(chalk.dim("  Mode: build + submit\n"));

  const platformSelection = await resolvePlatform(platformArg, project.hasIos, project.hasAndroid);
  const platforms: Platform[] =
    platformSelection === "both" ? ["ios", "android"] : [platformSelection];

  for (const platform of platforms) {
    const artifactPath = await buildPlatform(project, platform);

    if (noSubmit) {
      console.log(chalk.dim(`\n  Artifact saved: ${artifactPath}`));
    } else if (useTransporter) {
      openTransporter(artifactPath);
    } else if (platform === "ios") {
      await submitAltool(artifactPath);
    } else {
      await submitEas(project, platform, artifactPath);
    }
  }

  console.log(chalk.bold.green("\n  ✅ All done!\n"));
}

main().catch((err) => {
  console.error(
    chalk.red(`\n  ❌ ${err instanceof Error ? err.message : String(err)}\n`)
  );
  process.exit(1);
});
