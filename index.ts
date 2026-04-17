import { select } from "@inquirer/prompts";
import chalk from "chalk";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { projects, type PlatformConfig, type ProjectConfig } from "./projects.config";

type Platform = "ios" | "android";
type SubmitMethod = "eas" | "transporter" | "skip";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function run(command: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    console.log(chalk.dim(`  $ ${command} ${args.join(" ")}`));
    const proc = spawn(command, args, { shell: true, stdio: "inherit", cwd });
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`"${command} ${args.join(" ")}" exited with code ${code}`));
    });
  });
}

function startTimer(): () => void {
  const start = Date.now();
  const interval = setInterval(() => {
    const s = Math.floor((Date.now() - start) / 1000);
    process.stdout.write(`\r  ⏱  ${Math.floor(s / 60)}m ${s % 60}s `);
  }, 1000);
  return () => {
    clearInterval(interval);
    process.stdout.write("\n");
  };
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

async function build(project: ProjectConfig, platform: Platform): Promise<string> {
  const config = (platform === "ios" ? project.ios : project.android) as PlatformConfig;
  const cwd = project.path;
  const absOutput = path.join(cwd, config.outputPath);

  fs.mkdirSync(path.dirname(absOutput), { recursive: true });

  for (const step of config.preBuildSteps ?? []) {
    console.log(chalk.blue(`\n→ ${step.label}`));
    await run(step.command, step.args, cwd);
    console.log(chalk.green(`  ✓ done`));
  }

  console.log(chalk.blue(`\n📦 Building ${project.name} · ${platform.toUpperCase()}`));
  const stopTimer = startTimer();

  try {
    await run(
      "eas",
      [
        "build",
        "--platform", platform,
        "--profile", config.buildProfile,
        "--local",
        "--non-interactive",
        "--output", absOutput,
      ],
      cwd
    );
  } finally {
    stopTimer();
  }

  if (!fs.existsSync(absOutput)) {
    throw new Error(`Artifact not found at expected path: ${absOutput}`);
  }

  console.log(chalk.green(`✓ Artifact → ${absOutput}`));
  return absOutput;
}

// ---------------------------------------------------------------------------
// Submit via EAS
// ---------------------------------------------------------------------------

async function submitEas(project: ProjectConfig, platform: Platform, artifactPath: string): Promise<void> {
  console.log(chalk.blue("\n🚀 Submitting via EAS..."));
  const stopTimer = startTimer();

  try {
    await run(
      "eas",
      [
        "submit",
        "--platform", platform,
        "--profile", "production",
        "--path", artifactPath,
        "--non-interactive",
      ],
      project.path
    );
  } finally {
    stopTimer();
  }

  console.log(chalk.green("✓ Submitted to App Store Connect"));
}

// ---------------------------------------------------------------------------
// Submit via Transporter
// ---------------------------------------------------------------------------

async function extractIpa(tarPath: string): Promise<string> {
  const buildDir = path.dirname(tarPath);
  const extractDir = path.join(buildDir, "ipa");
  const ipaPath = path.join(buildDir, "app.ipa");

  fs.rmSync(extractDir, { recursive: true, force: true });
  fs.rmSync(ipaPath, { force: true });

  console.log(chalk.dim("  Extracting archive..."));
  await run("tar", ["-xzf", tarPath, "-C", buildDir], buildDir);

  console.log(chalk.dim("  Packaging IPA..."));
  await run("bash", ["-c", `cd "${extractDir}" && zip -qry "${ipaPath}" Payload`], buildDir);

  fs.rmSync(extractDir, { recursive: true, force: true });
  return ipaPath;
}

async function submitTransporter(platform: Platform, artifactPath: string): Promise<void> {
  let submitPath = artifactPath;

  if (platform === "ios" && artifactPath.endsWith(".tar.gz")) {
    console.log(chalk.blue("\n→ Extracting IPA from archive..."));
    submitPath = await extractIpa(artifactPath);
    console.log(chalk.green(`  ✓ IPA → ${submitPath}`));
  }

  console.log(chalk.blue("\n→ Opening Transporter..."));
  spawn("open", ["-a", "Transporter", submitPath], { stdio: "ignore", detached: true }).unref();
  console.log(chalk.green("  ✓ Transporter opened with your build"));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(chalk.bold("\n  expo-ship 🚢\n"));

  const project = await select({
    message: "Project",
    choices: projects.map((p) => ({ name: p.name, value: p })),
  });

  const platformChoices = [
    ...(project.ios ? [{ name: "iOS", value: "ios" as const }] : []),
    ...(project.android ? [{ name: "Android", value: "android" as const }] : []),
    ...(project.ios && project.android
      ? [{ name: "Both", value: "both" as const }]
      : []),
  ];

  const platformSelection = await select({
    message: "Platform",
    choices: platformChoices,
  });

  const submitMethod = await select<SubmitMethod>({
    message: "Submit via",
    choices: [
      {
        name: "EAS Submit",
        value: "eas",
        description: "Automatic — may occasionally hang",
      },
      {
        name: "Transporter",
        value: "transporter",
        description: "Opens Transporter app — more reliable",
      },
      {
        name: "Build only",
        value: "skip",
        description: "Skip submission, keep artifact",
      },
    ],
  });

  const platforms: Platform[] =
    platformSelection === "both" ? ["ios", "android"] : [platformSelection];

  for (const platform of platforms) {
    const artifactPath = await build(project, platform);

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
  console.error(chalk.red(`\n  ❌ ${err instanceof Error ? err.message : String(err)}\n`));
  process.exit(1);
});
