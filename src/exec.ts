import chalk from "chalk";
import { spawn } from "child_process";

interface RunOptions {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  quiet?: boolean;
}

export function run(command: string, args: string[], { cwd, env, quiet }: RunOptions): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!quiet) console.log(chalk.dim(`  $ ${command} ${args.join(" ")}`));
    const proc = spawn(command, args, { stdio: "inherit", cwd, env: { ...process.env, ...env } });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`"${command} ${args[0] ?? ""}" failed (exit ${code})`));
    });
  });
}

export function capture(command: string, args: string[], cwd?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    proc.stdout.on("data", (d: Buffer) => (out += d.toString()));
    proc.stderr.on("data", (d: Buffer) => (err += d.toString()));
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve(out.trim());
      else reject(new Error(`"${command} ${args[0] ?? ""}" failed (exit ${code})\n${err.trim()}`));
    });
  });
}

export async function commandExists(command: string): Promise<boolean> {
  try {
    await capture("which", [command]);
    return true;
  } catch {
    return false;
  }
}
