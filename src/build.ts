import chalk from "chalk";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import type { ProjectInfo } from "./validate";

export type Platform = "ios" | "android";

const OUTPUT: Record<Platform, string> = {
  ios: "build/ios-archive.tar.gz",
  android: "build/android-prod.aab",
};

function run(command: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    console.log(chalk.dim(`  $ ${command} ${args.join(" ")}`));
    const proc = spawn(command, args, { shell: true, stdio: "inherit", cwd });
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`"${command} ${args.join(" ")}" failed (exit ${code})`));
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

export async function buildPlatform(project: ProjectInfo, platform: Platform): Promise<string> {
  const { cwd, packageManager, hasPreBuildScript } = project;
  const outputPath = path.join(cwd, OUTPUT[platform]);

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  if (hasPreBuildScript) {
    console.log(chalk.blue("\n→ Running ship:prebuild..."));
    await run(packageManager, ["run", "ship:prebuild"], cwd);
    console.log(chalk.green("  ✓ Pre-build complete"));
  }

  console.log(chalk.blue(`\n📦 Building · ${platform.toUpperCase()}`));
  const stopTimer = startTimer();

  try {
    await run(
      "eas",
      [
        "build",
        "--platform", platform,
        "--profile", "production-local",
        "--local",
        "--non-interactive",
        "--output", outputPath,
      ],
      cwd
    );
  } finally {
    stopTimer();
  }

  if (!fs.existsSync(outputPath)) {
    throw new Error(`Build artifact not found at: ${outputPath}`);
  }

  console.log(chalk.green(`  ✓ Artifact → ${outputPath}`));
  return outputPath;
}
