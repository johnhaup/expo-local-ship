import { input, confirm } from "@inquirer/prompts";
import chalk from "chalk";
import fs from "fs";
import os from "os";
import path from "path";

const CONFIG_PATH = path.join(os.homedir(), ".expo-local-ship.json");
const KEYS_DIR = path.join(os.homedir(), ".appstoreconnect", "private_keys");

export async function runSetup(): Promise<void> {
  console.log(chalk.bold("  App Store Connect API Key Setup\n"));
  console.log(chalk.dim("  Generate a key at:"));
  console.log(chalk.dim("  App Store Connect → Users & Access → Integrations → App Store Connect API\n"));

  const existing = loadExisting();

  const apiKey = await input({
    message: "API Key ID",
    default: existing?.apiKey,
    validate: (v) => v.trim().length > 0 || "Required",
  });

  const apiIssuer = await input({
    message: "Issuer ID",
    default: existing?.apiIssuer,
    validate: (v) => v.trim().length > 0 || "Required",
  });

  const expectedP8 = path.join(KEYS_DIR, `AuthKey_${apiKey.trim()}.p8`);
  const p8Exists = fs.existsSync(expectedP8);

  if (!p8Exists) {
    const p8Path = await input({
      message: `Path to AuthKey_${apiKey.trim()}.p8 file`,
      validate: (v) => {
        const resolved = resolvePath(v);
        if (!fs.existsSync(resolved)) return `File not found: ${resolved}`;
        if (!resolved.endsWith(".p8")) return "Expected a .p8 file";
        return true;
      },
    });

    fs.mkdirSync(KEYS_DIR, { recursive: true });
    fs.copyFileSync(resolvePath(p8Path), expectedP8);
    console.log(chalk.green(`\n  ✓ Copied .p8 to ${expectedP8}`));
  } else {
    console.log(chalk.green(`\n  ✓ .p8 already exists at ${expectedP8}`));
  }

  const config = { apiKey: apiKey.trim(), apiIssuer: apiIssuer.trim() };
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n");
  console.log(chalk.green(`  ✓ Saved config to ${CONFIG_PATH}`));

  // Verify
  console.log(chalk.dim(`\n  Verifying...`));
  const canValidate = fs.existsSync(expectedP8) && fs.existsSync(CONFIG_PATH);
  if (canValidate) {
    console.log(chalk.bold.green("\n  ✅ Setup complete! iOS submission is ready for all your apps.\n"));
  } else {
    console.log(chalk.yellow("\n  ⚠  Something looks off. Check the files above exist.\n"));
  }
}

function loadExisting(): { apiKey?: string; apiIssuer?: string } | undefined {
  if (!fs.existsSync(CONFIG_PATH)) return undefined;
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  } catch {
    return undefined;
  }
}

function resolvePath(p: string): string {
  if (p.startsWith("~")) return path.join(os.homedir(), p.slice(1));
  return path.resolve(p);
}
