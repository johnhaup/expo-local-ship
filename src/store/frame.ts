import chalk from "chalk";
import fs from "fs";
import os from "os";
import path from "path";
import { capture, run } from "../exec";
import type { PosterConfig, ScreenshotsConfig, ShipConfig, ThemeConfig } from "./config";

// Layout is designed at 1320pt wide and scaled to the configured size
const DESIGN_WIDTH = 1320;
// Edge shading from the far side of the rail to the near side, with a highlight before the face
const RAIL_TONES = ["1c1e21", "25282c", "303338", "3d4046", "4b4f56", "5b6068", "6c717a", "7c828b", "6a6f77", "555a61"];

interface Bezel {
  path: string;
  width: number;
  height: number;
  hole: { w: number; h: number; x: number; y: number };
  mask: string;
}

function magick(args: string[]): Promise<void> {
  return run("magick", args, { cwd: process.cwd(), quiet: true });
}

function escapeXml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

async function renderSvg(svg: string, out: string): Promise<void> {
  const svgPath = out.replace(/\.png$/, ".svg");
  fs.writeFileSync(svgPath, svg);
  await run("rsvg-convert", [svgPath, "-o", out], { cwd: process.cwd(), quiet: true });
}

async function loadBezel(bezelPath: string, tmp: string): Promise<Bezel> {
  if (!fs.existsSync(bezelPath)) throw new Error(`Bezel not found: ${bezelPath}`);
  const [width, height] = (await capture("magick", ["identify", "-format", "%w %h", bezelPath])).split(" ").map(Number);

  // The screen is the transparent hole in the middle of the frame
  const full = path.join(tmp, "hole-full.png");
  await magick([
    bezelPath, "-alpha", "extract", "-fuzz", "40%", "-fill", "red",
    "-draw", `color ${Math.floor(width / 2)},${Math.floor(height / 2)} floodfill`,
    "-fill", "black", "+opaque", "red", "-fill", "white", "-opaque", "red", full,
  ]);
  const [w, h, x, y] = (await capture("magick", [full, "-trim", "-format", "%w %h %X %Y", "info:"]))
    .split(" ")
    .map((v) => parseInt(v, 10));
  const mask = path.join(tmp, "hole.png");
  await magick([full, "-crop", `${w}x${h}+${x}+${y}`, "+repage", mask]);

  return { path: bezelPath, width, height, hole: { w, h, x, y }, mask };
}

async function renderDevice(rawPath: string, bezel: Bezel, out: string, tmp: string): Promise<void> {
  const { w, h, x, y } = bezel.hole;
  const screenRaw = path.join(tmp, "screen-raw.png");
  const screen = path.join(tmp, "screen.png");
  await magick([rawPath, "-resize", `${w}x`, "-gravity", "north", "-crop", `${w}x${h}+0+0`, "+repage", screenRaw]);
  await magick([screenRaw, bezel.mask, "-alpha", "off", "-compose", "CopyOpacity", "-composite", screen]);
  await magick([
    "-size", `${bezel.width}x${bezel.height}`, "xc:none",
    screen, "-geometry", `+${x}+${y}`, "-composite",
    bezel.path, "-composite", out,
  ]);
}

function backgroundSvg(width: number, height: number, theme: ThemeConfig, glowY: number, glowX = 0.5): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${theme.background[0]}"/><stop offset="1" stop-color="${theme.background[1]}"/></linearGradient>
    <radialGradient id="glow" cx="${glowX}" cy="${glowY}" r="0.55"><stop offset="0" stop-color="${theme.accent}" stop-opacity="0.26"/><stop offset="1" stop-color="${theme.accent}" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#bg)"/>
  <rect width="${width}" height="${height}" fill="url(#glow)"/>
</svg>`;
}

/** Corners of the device after laying it on a table, spinning it, and viewing it in perspective */
function perspectiveCorners(width: number, height: number, poster: PosterConfig): string {
  const spin = (poster.spin * Math.PI) / 180;
  const tilt = (poster.tilt * Math.PI) / 180;
  const focal = 5200;
  const projected = [[0, 0], [width, 0], [width, height], [0, height]].map(([sx, sy]) => {
    const x = sx - width / 2;
    const y = sy - height / 2;
    const xr = x * Math.cos(spin) - y * Math.sin(spin);
    const yr = x * Math.sin(spin) + y * Math.cos(spin);
    const scale = focal / (focal - yr * Math.sin(tilt));
    return [xr * scale, yr * Math.cos(tilt) * scale];
  });
  const minX = Math.min(...projected.map(([x]) => x));
  const minY = Math.min(...projected.map(([, y]) => y));
  return projected
    .map(([x, y], i) => {
      const [sx, sy] = [[0, 0], [width, 0], [width, height], [0, height]][i];
      return `${sx},${sy} ${(x - minX).toFixed(1)},${(y - minY).toFixed(1)}`;
    })
    .join("  ");
}

/** The angled phone and rounded logo are the same in every locale, so they're rendered once */
async function preparePoster(
  poster: PosterConfig,
  rawPath: string,
  bezel: Bezel,
  screenshots: ScreenshotsConfig,
  tmp: string
): Promise<void> {
  const k = screenshots.size[0] / DESIGN_WIDTH;
  const p = (name: string) => path.join(tmp, name);

  await renderDevice(rawPath, bezel, p("device.png"), tmp);
  await magick([
    p("device.png"), "-virtual-pixel", "transparent", "-background", "none",
    "+distort", "Perspective", perspectiveCorners(bezel.width, bezel.height, poster),
    "-trim", "+repage", "-bordercolor", "none", "-border", `${poster.depth + 20}`, p("face.png"),
  ]);

  // The rail is the phone's silhouette (buttons smoothed away) stacked downward
  await magick([p("face.png"), "-alpha", "extract", "-threshold", "50%", "-morphology", "Open", "Disk:45", p("sil.png")]);
  await magick([p("sil.png"), "-set", "option:dims", "%wx%h", "-delete", "0", "-size", "%[dims]", "gradient:#ffffff-#a8a8a8", p("vshade.png")]);
  for (const [i, tone] of RAIL_TONES.entries()) {
    await magick([
      p("sil.png"), "-set", "option:dims", "%wx%h",
      "(", "-size", "%[dims]", `xc:#${tone}`, p("vshade.png"), "-compose", "Multiply", "-composite", ")",
      "+swap", "-alpha", "off", "-compose", "CopyOpacity", "-composite", p(`rail${i}.png`),
    ]);
  }
  const layers: string[] = [];
  for (let i = poster.depth; i >= 1; i--) {
    const tone = Math.min(RAIL_TONES.length - 1, Math.floor(((poster.depth - i) * RAIL_TONES.length) / poster.depth));
    layers.push(p(`rail${tone}.png`), "-geometry", `+0+${i}`, "-composite");
  }
  await magick([
    p("face.png"), "-set", "option:dims", "%wx%h", "-delete", "0", "-size", "%[dims]", "xc:none",
    ...layers,
    "(", p("sil.png"), "-background", "none", "-alpha", "shape", "-fill", "#8d929a", "-colorize", "100", ")",
    "-geometry", "+0+1", "-composite",
    p("face.png"), "-composite", "-trim", "+repage", p("body.png"),
  ]);
  await magick([
    p("body.png"), "-resize", `${Math.round(poster.width * k)}x`,
    "(", "+clone", "-background", "#000000", "-shadow", "70x50+0+90", ")",
    "+swap", "-background", "none", "-layers", "merge", "+repage", p("phone.png"),
  ]);

  const logoSize = Math.round(220 * k);
  const radius = Math.round(50 * k);
  await magick([
    poster.icon, "-resize", `${logoSize}x${logoSize}`,
    "(", "-size", `${logoSize}x${logoSize}`, "xc:none", "-fill", "white",
    "-draw", `roundrectangle 0,0 ${logoSize - 1},${logoSize - 1} ${radius},${radius}`, ")",
    "-alpha", "set", "-compose", "DstIn", "-composite", p("logo.png"),
  ]);
}

const RTL_LANGUAGES = ["ar", "he", "ur", "fa"];

function directionAttr(locale: string): string {
  return RTL_LANGUAGES.includes(locale.split("-")[0]) ? ' direction="rtl"' : "";
}

interface Caption {
  title: [string, string];
  subtitle?: string;
}

/** Shrinks the font size until the rendered line fits within maxWidth */
async function fitFontSize(text: string, size: number, bold: boolean, maxWidth: number, font: string, tmp: string): Promise<number> {
  const probe = path.join(tmp, `probe-${size}.png`);
  await renderSvg(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${maxWidth * 3}" height="${size * 2}"><text x="10" y="${size * 1.4}" font-family="${font}"${bold ? ' font-weight="bold"' : ""} font-size="${size}" fill="#fff">${escapeXml(text)}</text></svg>`,
    probe
  );
  const width = Number(await capture("magick", [probe, "-trim", "-format", "%w", "info:"]));
  return width > maxWidth ? Math.floor((size * maxWidth) / width) : size;
}

async function frameShot(
  caption: Caption,
  locale: string,
  deviceScaled: string,
  out: string,
  screenshots: ScreenshotsConfig,
  tmp: string
): Promise<void> {
  const [width, height] = screenshots.size;
  const { theme } = screenshots;
  const k = width / DESIGN_WIDTH;
  const deviceWidth = Math.round(1060 * k);
  const cx = width / 2;
  const maxWidth = Math.round(1200 * k);
  const dir = directionAttr(locale);
  const titleSize = Math.min(
    await fitFontSize(caption.title[0], 104 * k, true, maxWidth, theme.font, tmp),
    await fitFontSize(caption.title[1], 104 * k, true, maxWidth, theme.font, tmp)
  );
  const subtitleSize = caption.subtitle ? await fitFontSize(caption.subtitle, 48 * k, false, maxWidth, theme.font, tmp) : 0;

  const bg = backgroundSvg(width, height, theme, 0.62).replace(
    "</svg>",
    `  <text x="${cx}" y="${250 * k}" text-anchor="middle"${dir} font-family="${theme.font}" font-weight="bold" font-size="${titleSize}" fill="${theme.text}">${escapeXml(caption.title[0])}</text>
  <text x="${cx}" y="${372 * k}" text-anchor="middle"${dir} font-family="${theme.font}" font-weight="bold" font-size="${titleSize}" fill="${theme.accent}">${escapeXml(caption.title[1])}</text>
  ${caption.subtitle ? `<text x="${cx}" y="${490 * k}" text-anchor="middle"${dir} font-family="${theme.font}" font-size="${subtitleSize}" fill="${theme.muted}">${escapeXml(caption.subtitle)}</text>` : ""}
</svg>`
  );
  const bgPng = path.join(tmp, "bg.png");
  await renderSvg(bg, bgPng);
  await magick([
    bgPng, deviceScaled, "-geometry", `+${Math.round((width - deviceWidth) / 2)}+${Math.round(600 * k)}`,
    "-composite", "-alpha", "off", `PNG24:${out}`,
  ]);
}

async function framePoster(
  poster: PosterConfig,
  subtitle: string | undefined,
  locale: string,
  prepared: string,
  out: string,
  screenshots: ScreenshotsConfig,
  tmp: string
): Promise<void> {
  const [width, height] = screenshots.size;
  const { theme } = screenshots;
  const k = width / DESIGN_WIDTH;
  const p = (name: string) => path.join(tmp, name);
  const dir = directionAttr(locale);
  const subtitleSize = subtitle ? await fitFontSize(subtitle, 52 * k, false, Math.round(1200 * k), theme.font, tmp) : 0;

  await renderSvg(backgroundSvg(width, height, theme, 0.38, 0.45), p("bg.png"));
  const fadeTop = Math.round(1950 * k);
  await renderSvg(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <defs><linearGradient id="fade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${theme.background[1]}" stop-opacity="0"/><stop offset="0.55" stop-color="${theme.background[1]}" stop-opacity="0.92"/><stop offset="1" stop-color="${theme.background[1]}" stop-opacity="1"/></linearGradient></defs>
  <rect y="${fadeTop}" width="${width}" height="${height - fadeTop}" fill="url(#fade)"/>
  <text x="${width / 2}" y="${2600 * k}" text-anchor="middle" font-family="${theme.font}" font-weight="bold" font-size="${112 * k}" fill="${theme.text}">${escapeXml(poster.title)}</text>
  ${subtitle ? `<text x="${width / 2}" y="${2695 * k}" text-anchor="middle"${dir} font-family="${theme.font}" font-size="${subtitleSize}" fill="${theme.muted}">${escapeXml(subtitle)}</text>` : ""}
</svg>`,
    p("fg.png")
  );

  const sign = (n: number) => (n >= 0 ? `+${n}` : `${n}`);
  await magick([
    p("bg.png"), path.join(prepared, "phone.png"), "-geometry", `${sign(Math.round(poster.x * k))}${sign(Math.round(poster.y * k))}`, "-composite",
    p("fg.png"), "-composite",
    path.join(prepared, "logo.png"), "-gravity", "north", "-geometry", `+0+${Math.round(2240 * k)}`, "-composite",
    "-alpha", "off", `PNG24:${out}`,
  ]);
}

export function rawDir(screenshots: ScreenshotsConfig): string {
  return path.join(screenshots.dir, "raw");
}

const CONCURRENCY = 4;

/** The primary locale plus every localized listing that has its own captions */
function captionLocales(config: ShipConfig): string[] {
  return [config.locale, ...Object.keys(config.localizations).filter((l) => config.localizations[l].captions)];
}

export async function frameScreenshots(
  config: ShipConfig,
  screenshots: ScreenshotsConfig,
  { only }: { only?: string[] } = {}
): Promise<void> {
  const raws = rawDir(screenshots);
  const rawPath = (name: string) => {
    const file = path.join(raws, `${name}.png`);
    if (!fs.existsSync(file)) throw new Error(`Missing raw screenshot ${file}. Run "screenshots capture" first.`);
    return file;
  };
  const locales = captionLocales(config).filter((l) => !only || only.includes(l));

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ship-frame-"));
  try {
    const bezel = await loadBezel(screenshots.bezel, tmp);
    const k = screenshots.size[0] / DESIGN_WIDTH;
    const devices = new Map<string, string>();
    for (const shot of screenshots.shots) {
      if (devices.has(shot.raw)) continue;
      const device = path.join(tmp, `device-${shot.raw}.png`);
      const scaled = path.join(tmp, `device-${shot.raw}-scaled.png`);
      await renderDevice(rawPath(shot.raw), bezel, device, tmp);
      await magick([device, "-resize", `${Math.round(1060 * k)}x`, scaled]);
      devices.set(shot.raw, scaled);
    }
    const posterDir = path.join(tmp, "poster");
    if (screenshots.poster) {
      fs.mkdirSync(posterDir);
      await preparePoster(screenshots.poster, rawPath(screenshots.poster.raw), bezel, screenshots, posterDir);
    }

    const queue = [...locales];
    const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
      for (let locale = queue.shift(); locale !== undefined; locale = queue.shift()) {
        const captions = config.localizations[locale]?.captions ?? {};
        const outDir = path.join(screenshots.dir, "framed", locale);
        const work = path.join(tmp, locale);
        fs.rmSync(outDir, { recursive: true, force: true });
        fs.mkdirSync(outDir, { recursive: true });
        fs.mkdirSync(work);

        if (screenshots.poster) {
          const subtitle = captions.poster?.subtitle ?? screenshots.poster.subtitle;
          await framePoster(screenshots.poster, subtitle, locale, posterDir, path.join(outDir, "00-poster.png"), screenshots, work);
        }
        for (const [i, shot] of screenshots.shots.entries()) {
          const caption = { ...shot, ...captions[shot.raw] };
          const out = path.join(outDir, `${String(i + 1).padStart(2, "0")}-${shot.raw}.png`);
          await frameShot(caption, locale, devices.get(shot.raw) ?? "", out, screenshots, work);
        }
        console.log(chalk.dim(`  → ${locale}`));
      }
    });
    await Promise.all(workers);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  console.log(chalk.green(`  ✓ Framed ${locales.length} locale(s) → ${path.join(screenshots.dir, "framed")}`));
}
