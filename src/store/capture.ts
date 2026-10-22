import chalk from "chalk";
import fs from "fs";
import os from "os";
import path from "path";
import { capture, run } from "../exec";
import type { ScreenshotsConfig, ShipConfig } from "./config";
import { rawDir } from "./frame";

/** Build-time flag apps check to enable their demo-data deep link */
export const DEMO_ENV = "EXPO_PUBLIC_STORE_DEMO";

interface SimDevice {
  udid: string;
  name: string;
  state: string;
  isAvailable: boolean;
}

async function findSimulator(name: string): Promise<SimDevice> {
  const json = JSON.parse(await capture("xcrun", ["simctl", "list", "devices", "available", "-j"]));
  const devices: SimDevice[] = Object.values<SimDevice[]>(json.devices).flat();
  const device = devices.find((d) => d.name === name);
  if (!device) throw new Error(`No available simulator named "${name}". Create one in Xcode or change screenshots.simulator.`);
  return device;
}

function collectPngs(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return collectPngs(full);
    return entry.name.endsWith(".png") ? [full] : [];
  });
}

export async function captureScreenshots(
  config: ShipConfig,
  screenshots: ScreenshotsConfig,
  { build }: { build: boolean }
): Promise<void> {
  if (!fs.existsSync(screenshots.flow)) throw new Error(`Maestro flow not found: ${screenshots.flow}`);
  const { cwd } = config;
  const device = await findSimulator(screenshots.simulator);

  console.log(chalk.blue(`\n📱 ${device.name} (${device.udid})`));
  if (device.state !== "Booted") {
    await run("xcrun", ["simctl", "boot", device.udid], { cwd });
  }
  await run("xcrun", ["simctl", "bootstatus", device.udid, "-b"], { cwd, quiet: true });
  await run("open", ["-a", "Simulator"], { cwd, quiet: true });
  await run(
    "xcrun",
    [
      "simctl", "status_bar", device.udid, "override",
      "--time", "9:41", "--dataNetwork", "wifi", "--wifiMode", "active", "--wifiBars", "3",
      "--cellularMode", "active", "--cellularBars", "4", "--batteryState", "charged", "--batteryLevel", "100",
    ],
    { cwd, quiet: true }
  );

  if (build) {
    console.log(chalk.blue(`\n📦 Release build with ${DEMO_ENV}=1`));
    const runner = fs.existsSync(path.join(cwd, "bun.lock")) || fs.existsSync(path.join(cwd, "bun.lockb")) ? "bunx" : "npx";
    await run(runner, ["expo", "run:ios", "--configuration", "Release", "--device", device.udid, "--no-bundler"], {
      cwd,
      env: { [DEMO_ENV]: "1" },
    });
  }

  console.log(chalk.blue("\n🎬 Capturing with Maestro"));
  const output = fs.mkdtempSync(path.join(os.tmpdir(), "ship-maestro-"));
  try {
    try {
      await run("maestro", ["--device", device.udid, "test", screenshots.flow, "--test-output-dir", output], { cwd });
    } catch (err) {
      // Maestro's screenshots of the failing step are the fastest way to tell a bad selector from a crashed app
      const debugDir = path.join(screenshots.dir, "maestro-debug");
      fs.rmSync(debugDir, { recursive: true, force: true });
      fs.cpSync(output, debugDir, { recursive: true });
      console.log(chalk.yellow(`  Maestro debug output → ${debugDir}`));
      throw err;
    }
    const pngs = collectPngs(output).filter((f) => path.basename(path.dirname(f)) === "takeScreenshot");
    if (pngs.length === 0) throw new Error("Maestro finished without taking any screenshots (use takeScreenshot: <name> in the flow)");

    const dest = rawDir(screenshots);
    fs.mkdirSync(dest, { recursive: true });
    for (const file of pngs) {
      fs.copyFileSync(file, path.join(dest, path.basename(file)));
      console.log(chalk.dim(`  → ${path.basename(file)}`));
    }
    console.log(chalk.green(`  ✓ ${pngs.length} screenshots → ${dest}`));
  } finally {
    fs.rmSync(output, { recursive: true, force: true });
    await run("xcrun", ["simctl", "status_bar", device.udid, "clear"], { cwd, quiet: true });
  }
}
