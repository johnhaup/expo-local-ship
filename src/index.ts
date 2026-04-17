import { select } from "@inquirer/prompts";
import chalk from "chalk";
import { buildPlatform, type Platform } from "./build";
import { submitEas } from "./submit";
import { validate } from "./validate";

const VALID_PLATFORMS = ["ios", "android", "both"] as const;
type PlatformArg = (typeof VALID_PLATFORMS)[number];

function parseArgs(): { platformArg: PlatformArg | undefined; noSubmit: boolean } {
  const args = process.argv.slice(2);
  const noSubmit = args.includes("--no-submit");
  const platformArg = args.find((a): a is PlatformArg =>
    VALID_PLATFORMS.includes(a as PlatformArg)
  );
  return { platformArg, noSubmit };
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

  const { platformArg, noSubmit } = parseArgs();
  const project = validate(cwd);
  console.log(chalk.dim(`  Project: ${project.name}`));
  if (noSubmit) console.log(chalk.dim("  Mode: build only (--no-submit)\n"));
  else console.log(chalk.dim("  Mode: build + submit\n"));

  const platformSelection = await resolvePlatform(platformArg, project.hasIos, project.hasAndroid);
  const platforms: Platform[] =
    platformSelection === "both" ? ["ios", "android"] : [platformSelection];

  for (const platform of platforms) {
    const artifactPath = await buildPlatform(project, platform);

    if (noSubmit) {
      console.log(chalk.dim(`\n  Artifact saved: ${artifactPath}`));
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
