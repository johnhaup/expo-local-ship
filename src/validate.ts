import fs from "fs";
import path from "path";
import chalk from "chalk";

interface EasProfile {
  credentialsSource?: string;
  distribution?: string;
  developmentClient?: boolean;
}

interface EasJson {
  build?: Record<string, EasProfile>;
  submit?: {
    production?: {
      ios?: { ascAppId?: string };
      android?: unknown;
    };
  };
}

interface AppJson {
  expo?: { name?: string };
  name?: string;
}

interface PackageJson {
  scripts?: Record<string, string>;
  packageManager?: string;
}

export interface ProjectInfo {
  name: string;
  cwd: string;
  hasIos: boolean;
  hasAndroid: boolean;
  hasPreBuildScript: boolean;
  packageManager: "bun" | "npm" | "yarn";
  submitConfigured: boolean;
}

function fail(message: string): never {
  console.error(chalk.red(`\n  ✗ ${message}\n`));
  process.exit(1);
}

export function validate(cwd: string): ProjectInfo {
  // eas.json
  const easPath = path.join(cwd, "eas.json");
  if (!fs.existsSync(easPath)) {
    fail('No eas.json found. Is this an Expo project with EAS configured?');
  }

  let eas: EasJson;
  try {
    eas = JSON.parse(fs.readFileSync(easPath, "utf8"));
  } catch {
    fail("Could not parse eas.json.");
  }

  const profile = eas!.build?.["production-local"];
  if (!profile) {
    fail(
      'eas.json is missing a "production-local" build profile.\n\n' +
      '  Add this to your eas.json:\n\n' +
      '  "production-local": {\n' +
      '    "credentialsSource": "local",\n' +
      '    "distribution": "store",\n' +
      '    "developmentClient": false,\n' +
      '    "autoIncrement": true\n' +
      '  }'
    );
  }

  if (profile!.credentialsSource !== "local") {
    fail('"production-local" profile must have credentialsSource: "local"');
  }

  // credentials.json
  if (!fs.existsSync(path.join(cwd, "credentials.json"))) {
    fail(
      'credentials.json not found.\n\n' +
      '  Create one with your local distribution cert and provisioning profile.\n' +
      '  See: https://docs.expo.dev/app-signing/local-credentials/'
    );
  }

  // app.json — name
  let appName = path.basename(cwd);
  const appJsonPath = path.join(cwd, "app.json");
  if (fs.existsSync(appJsonPath)) {
    try {
      const appJson: AppJson = JSON.parse(fs.readFileSync(appJsonPath, "utf8"));
      appName = appJson.expo?.name ?? appJson.name ?? appName;
    } catch {
      // use dirname fallback
    }
  }

  // package.json — pre-build script + package manager
  let hasPreBuildScript = false;
  let packageManager: ProjectInfo["packageManager"] = "npm";
  const pkgPath = path.join(cwd, "package.json");
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg: PackageJson = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
      hasPreBuildScript = !!pkg.scripts?.["ship:prebuild"];
      const pm = pkg.packageManager ?? "";
      if (pm.startsWith("yarn")) packageManager = "yarn";
      else if (pm.startsWith("bun")) packageManager = "bun";
      else if (fs.existsSync(path.join(cwd, "bun.lockb")) || fs.existsSync(path.join(cwd, "bun.lock"))) {
        packageManager = "bun";
      } else if (fs.existsSync(path.join(cwd, "yarn.lock"))) {
        packageManager = "yarn";
      }
    } catch {
      // use defaults
    }
  }

  // Platform detection — ios/ and android/ dirs indicate native code is present.
  // For managed workflow without prebuild run, fall back to offering both.
  const hasIos = fs.existsSync(path.join(cwd, "ios"));
  const hasAndroid = fs.existsSync(path.join(cwd, "android"));

  // Submit config present?
  const submitConfigured = !!(
    eas!.submit?.production?.ios?.ascAppId || eas!.submit?.production?.android
  );

  return { name: appName, cwd, hasIos, hasAndroid, hasPreBuildScript, packageManager, submitConfigured };
}
