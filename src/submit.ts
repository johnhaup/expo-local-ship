import chalk from "chalk";
import { spawn } from "child_process";
import type { Platform } from "./build";
import type { ProjectInfo } from "./validate";

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

  const destination = platform === "ios" ? "App Store Connect" : "Google Play";
  console.log(chalk.green(`  ✓ Submitted to ${destination}`));
}

export function openTransporter(artifactPath: string): void {
  console.log(chalk.blue("\n→ Opening Transporter..."));
  spawn("open", ["-a", "Transporter", artifactPath], {
    stdio: "ignore",
    detached: true,
  }).unref();
  console.log(chalk.green("  ✓ Transporter opened with your build"));
}
