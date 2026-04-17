import { select } from "@inquirer/prompts";
import chalk from "chalk";
import { buildPlatform, type Platform } from "./build";
import { submitEas, submitTransporter } from "./submit";
import { validate } from "./validate";

type SubmitMethod = "eas" | "transporter" | "skip";

function submitChoicesForPlatform(platform: Platform, submitConfigured: boolean) {
  const easDescription = submitConfigured
    ? "Automatic — may occasionally hang"
    : "⚠ No submit config in eas.json — may prompt for credentials";

  return [
    { name: "EAS Submit", value: "eas" as const, description: easDescription },
    ...(platform === "ios"
      ? [{ name: "Transporter", value: "transporter" as const, description: "Opens Transporter app — more reliable" }]
      : []),
    { name: "Build only", value: "skip" as const, description: "Skip submission, keep artifact" },
  ];
}

async function main() {
  const cwd = process.cwd();
  console.log(chalk.bold("\n  expo-local-ship 🚢\n"));

  const project = validate(cwd);
  console.log(chalk.dim(`  Project: ${project.name}\n`));

  // Platform choices — offer both if we can't detect native dirs
  // (managed workflow without a prebuild run won't have ios/ or android/)
  const bothAvailable = !project.hasIos && !project.hasAndroid;
  const platformChoices = [
    ...(project.hasIos || bothAvailable ? [{ name: "iOS", value: "ios" as const }] : []),
    ...(project.hasAndroid || bothAvailable ? [{ name: "Android", value: "android" as const }] : []),
    ...(project.hasIos || project.hasAndroid || bothAvailable
      ? [{ name: "Both", value: "both" as const }]
      : []),
  ];

  const platformSelection = await select({
    message: "Platform",
    choices: platformChoices,
  });

  const platforms: Platform[] =
    platformSelection === "both" ? ["ios", "android"] : [platformSelection];

  for (const platform of platforms) {
    const artifactPath = await buildPlatform(project, platform);

    const submitMethod = await select<SubmitMethod>({
      message: `Submit ${platform.toUpperCase()} via`,
      choices: submitChoicesForPlatform(platform, project.submitConfigured),
    });

    if (submitMethod === "eas") {
      await submitEas(project, platform, artifactPath);
    } else if (submitMethod === "transporter") {
      await submitTransporter(platform, artifactPath);
    } else {
      console.log(chalk.dim(`\n  Artifact saved: ${artifactPath}`));
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
