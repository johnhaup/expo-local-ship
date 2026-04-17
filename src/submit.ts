import chalk from "chalk";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import type { Platform } from "./build";
import type { ProjectInfo } from "./validate";

function run(command: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
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

export async function submitEas(
  project: ProjectInfo,
  platform: Platform,
  artifactPath: string
): Promise<void> {
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
      project.cwd
    );
  } finally {
    stopTimer();
  }

  console.log(chalk.green("  ✓ Submitted to App Store Connect"));
}

async function extractIpa(tarPath: string): Promise<string> {
  const buildDir = path.dirname(tarPath);
  const extractDir = path.join(buildDir, "ipa");
  const ipaPath = path.join(buildDir, "app.ipa");

  fs.rmSync(extractDir, { recursive: true, force: true });
  fs.rmSync(ipaPath, { force: true });

  console.log(chalk.dim("  Extracting archive..."));
  await new Promise<void>((resolve, reject) => {
    const proc = spawn("tar", ["-xzf", tarPath, "-C", buildDir], { stdio: "inherit" });
    proc.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`tar failed (exit ${code})`))
    );
  });

  console.log(chalk.dim("  Packaging IPA..."));
  await new Promise<void>((resolve, reject) => {
    const proc = spawn("bash", ["-c", `cd "${extractDir}" && zip -qry "${ipaPath}" Payload`], {
      stdio: "inherit",
    });
    proc.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`zip failed (exit ${code})`))
    );
  });

  fs.rmSync(extractDir, { recursive: true, force: true });
  return ipaPath;
}

export async function submitTransporter(
  platform: Platform,
  artifactPath: string
): Promise<void> {
  let submitPath = artifactPath;

  if (platform === "ios" && artifactPath.endsWith(".tar.gz")) {
    console.log(chalk.blue("\n→ Extracting IPA..."));
    submitPath = await extractIpa(artifactPath);
    console.log(chalk.green(`  ✓ IPA → ${submitPath}`));
  }

  console.log(chalk.blue("\n→ Opening Transporter..."));
  spawn("open", ["-a", "Transporter", submitPath], {
    stdio: "ignore",
    detached: true,
  }).unref();
  console.log(chalk.green("  ✓ Transporter opened with your build"));
}
