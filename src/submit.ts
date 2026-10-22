import chalk from "chalk";
import fs from "fs";
import os from "os";
import path from "path";
import { spawn } from "child_process";
import type { Platform } from "./build";
import type { ProjectInfo } from "./validate";

interface AscConfig {
  apiKey: string;
  apiIssuer: string;
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

function loadAscConfig(): AscConfig {
  const apiKey = process.env.ASC_API_KEY;
  const apiIssuer = process.env.ASC_API_ISSUER;

  if (apiKey && apiIssuer) {
    return { apiKey, apiIssuer };
  }

  const configPath = path.join(os.homedir(), ".expo-local-ship.json");
  if (!fs.existsSync(configPath)) {
    console.error(chalk.red(`\n  ✗ iOS submission requires App Store Connect API key configuration.\n`));
    console.error(chalk.dim("  Option 1: Create ~/.expo-local-ship.json:\n"));
    console.error(chalk.dim('  {\n    "apiKey": "YOUR_KEY_ID",\n    "apiIssuer": "YOUR_ISSUER_ID"\n  }\n'));
    console.error(chalk.dim("  Option 2: Set environment variables:\n"));
    console.error(chalk.dim("  ASC_API_KEY=YOUR_KEY_ID ASC_API_ISSUER=YOUR_ISSUER_ID\n"));
    console.error(chalk.dim("  Your AuthKey_<KEY_ID>.p8 file should be in ~/.appstoreconnect/private_keys/\n"));
    process.exit(1);
  }

  try {
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    if (!config.apiKey || !config.apiIssuer) {
      console.error(chalk.red(`\n  ✗ ~/.expo-local-ship.json must contain "apiKey" and "apiIssuer"\n`));
      process.exit(1);
    }
    return { apiKey: config.apiKey, apiIssuer: config.apiIssuer };
  } catch {
    console.error(chalk.red(`\n  ✗ Could not parse ~/.expo-local-ship.json\n`));
    process.exit(1);
  }
}

export async function submitAltool(artifactPath: string): Promise<void> {
  const { apiKey, apiIssuer } = loadAscConfig();

  console.log(chalk.blue("\n🚀 Submitting to App Store Connect via altool..."));
  const stopTimer = startTimer();

  try {
    await new Promise<void>((resolve, reject) => {
      const proc = spawn(
        "xcrun",
        [
          "altool",
          "--upload-app",
          "-f", artifactPath,
          "-t", "ios",
          "--apiKey", apiKey,
          "--apiIssuer", apiIssuer,
        ],
        { stdio: "inherit" }
      );
      proc.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`altool upload failed (exit ${code})`));
      });
    });
  } finally {
    stopTimer();
  }

  console.log(chalk.green("  ✓ Submitted to App Store Connect"));
}

export async function submitEas(
  project: ProjectInfo,
  platform: Platform,
  artifactPath: string
): Promise<void> {
  console.log(chalk.blue("\n🚀 Submitting via EAS..."));
  const stopTimer = startTimer();

  try {
    await new Promise<void>((resolve, reject) => {
      const proc = spawn(
        "eas",
        [
          "submit",
          "--platform", platform,
          "--profile", "production",
          "--path", artifactPath,
          "--non-interactive",
        ],
        { shell: true, stdio: "inherit", cwd: project.cwd }
      );
      proc.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`eas submit failed (exit ${code})`));
      });
    });
  } finally {
    stopTimer();
  }

  console.log(chalk.green("  ✓ Submitted to Google Play"));
}

export function openTransporter(artifactPath: string): void {
  console.log(chalk.blue("\n→ Opening Transporter..."));
  spawn("open", ["-a", "Transporter", artifactPath], {
    stdio: "ignore",
    detached: true,
  }).unref();
  console.log(chalk.green("  ✓ Transporter opened with your build"));
}
