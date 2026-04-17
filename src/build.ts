import chalk from "chalk";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import type { ProjectInfo } from "./validate";

export type Platform = "ios" | "android";

const DEST: Record<Platform, string> = {
  ios: "build/app.ipa",
  android: "build/app.aab",
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

function easBuild(platform: Platform, cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const args = [
      "build",
      "--platform", platform,
      "--profile", "production-local",
      "--local",
      "--non-interactive",
    ];

    console.log(chalk.dim(`  $ eas ${args.join(" ")}`));

    const proc = spawn("eas", args, {
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
      cwd,
    });

    let artifactPath: string | undefined;

    proc.stdout?.on("data", (data: Buffer) => {
      const text = data.toString();
      const match = text.match(/You can find the build artifacts? in (.+)/);
      if (match) {
        artifactPath = match[1].trim();
      }
    });

    // Build output goes to stderr — pipe it through so the user sees progress
    proc.stderr?.on("data", (data: Buffer) => {
      process.stderr.write(data);
    });

    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`eas build failed (exit ${code})`));
        return;
      }
      if (!artifactPath) {
        reject(new Error("Build succeeded but could not find artifact path in output."));
        return;
      }
      resolve(artifactPath);
    });
  });
}

export async function buildPlatform(project: ProjectInfo, platform: Platform): Promise<string> {
  const { cwd, packageManager, hasPreBuildScript } = project;
  const destPath = path.join(cwd, DEST[platform]);

  fs.mkdirSync(path.dirname(destPath), { recursive: true });

  if (hasPreBuildScript) {
    console.log(chalk.blue("\n→ Running ship:prebuild..."));
    await run(packageManager, ["run", "ship:prebuild"], cwd);
    console.log(chalk.green("  ✓ Pre-build complete"));
  }

  console.log(chalk.blue(`\n📦 Building · ${platform.toUpperCase()}`));
  const stopTimer = startTimer();

  let rawPath: string;
  try {
    rawPath = await easBuild(platform, cwd);
  } finally {
    stopTimer();
  }

  // Move artifact from EAS temp location to ./build/
  fs.copyFileSync(rawPath, destPath);
  fs.rmSync(rawPath, { force: true });

  console.log(chalk.green(`  ✓ Artifact → ${destPath}`));
  return destPath;
}
