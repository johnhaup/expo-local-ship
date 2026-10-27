import chalk from "chalk";
import { spawn } from "child_process";
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

  try {
    await runMaestro(device.udid, config.bundleId, screenshots, cwd);
  } finally {
    await run("xcrun", ["simctl", "status_bar", device.udid, "clear"], { cwd, quiet: true });
  }
}

/** Runs the flow with APP_ID set, so one flow serves both platforms, and collects its screenshots */
async function runMaestro(deviceId: string, appId: string, screenshots: ScreenshotsConfig, cwd: string): Promise<void> {
  console.log(chalk.blue("\n🎬 Capturing with Maestro"));
  const output = fs.mkdtempSync(path.join(os.tmpdir(), "ship-maestro-"));
  try {
    try {
      await run(
        "maestro",
        ["--device", deviceId, "test", "-e", `APP_ID=${appId}`, screenshots.flow, "--test-output-dir", output],
        { cwd }
      );
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
  }
}

function androidHome(): string {
  return process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT ?? path.join(os.homedir(), "Library", "Android", "sdk");
}

const adbPath = () => path.join(androidHome(), "platform-tools", "adb");

function adb(serial: string, args: string[]): Promise<string> {
  return capture(adbPath(), ["-s", serial, ...args]);
}

/** Serial of the running emulator for this AVD, booting it if needed */
async function bootEmulator(avd: string): Promise<string> {
  const running = async () => {
    const serials = (await capture(adbPath(), ["devices"]))
      .split("\n")
      .map((line) => line.split("\t"))
      .filter(([serial, state]) => serial.startsWith("emulator-") && state === "device")
      .map(([serial]) => serial);
    for (const serial of serials) {
      const name = (await adb(serial, ["emu", "avd", "name"])).split("\n")[0].trim();
      if (name === avd) return serial;
    }
    return undefined;
  };

  let serial = await running();
  if (!serial) {
    console.log(chalk.dim(`  Booting ${avd}`));
    spawn(path.join(androidHome(), "emulator", "emulator"), ["-avd", avd, "-no-snapshot-save"], {
      detached: true,
      stdio: "ignore",
    }).unref();
    for (let i = 0; i < 120 && !serial; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      serial = await running();
    }
    if (!serial) throw new Error(`Emulator ${avd} did not come up`);
  }
  for (let i = 0; i < 120; i++) {
    if ((await adb(serial, ["shell", "getprop", "sys.boot_completed"])) === "1") return serial;
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`Emulator ${avd} did not finish booting`);
}

/** System UI demo mode: fixed clock, full battery and signal, no notification icons */
async function demoStatusBar(serial: string, enter: boolean): Promise<void> {
  const demo = (...extras: string[]) =>
    adb(serial, ["shell", "am", "broadcast", "-a", "com.android.systemui.demo", ...extras]);
  if (!enter) {
    await demo("-e", "command", "exit");
    return;
  }
  await adb(serial, ["shell", "settings", "put", "global", "sysui_demo_allowed", "1"]);
  await demo("-e", "command", "enter");
  await demo("-e", "command", "clock", "-e", "hhmm", "0941");
  await demo("-e", "command", "battery", "-e", "level", "100", "-e", "plugged", "false");
  // Without "fully" the Wi-Fi icon shows "!" for no internet; mobile data adds a "3G" label
  await demo("-e", "command", "network", "-e", "wifi", "show", "-e", "level", "4", "-e", "fully", "true");
  await demo("-e", "command", "network", "-e", "mobile", "hide");
  await demo("-e", "command", "notifications", "-e", "visible", "false");
}

export async function captureAndroidScreenshots(
  config: ShipConfig,
  screenshots: ScreenshotsConfig,
  { build }: { build: boolean }
): Promise<void> {
  if (!fs.existsSync(screenshots.flow)) throw new Error(`Maestro flow not found: ${screenshots.flow}`);
  if (!config.androidPackage) throw new Error("No Android package: set android.package in app.json");
  const { cwd } = config;
  const avd = screenshots.simulator || (await capture(path.join(androidHome(), "emulator", "emulator"), ["-list-avds"])).split("\n")[0];
  if (!avd) throw new Error("No Android emulator found. Create one in Android Studio or set screenshots.android.emulator.");

  console.log(chalk.blue(`\n🤖 ${avd}`));
  const serial = await bootEmulator(avd);

  if (build) {
    console.log(chalk.blue(`\n📦 Release build with ${DEMO_ENV}=1`));
    const runner = fs.existsSync(path.join(cwd, "bun.lock")) || fs.existsSync(path.join(cwd, "bun.lockb")) ? "bunx" : "npx";
    await run(runner, ["expo", "run:android", "--variant", "release", "--device", avd, "--no-bundler"], {
      cwd,
      env: { [DEMO_ENV]: "1", ANDROID_HOME: androidHome() },
    });
  }

  await demoStatusBar(serial, true);
  try {
    await runMaestro(serial, config.androidPackage, screenshots, cwd);
  } finally {
    await demoStatusBar(serial, false);
  }
}
