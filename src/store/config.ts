import fs from "fs";
import os from "os";
import path from "path";

export const CONFIG_FILE = "ship.config.json";

export interface ListingConfig {
  name: string;
  subtitle?: string;
  promotionalText?: string;
  description: string;
  keywords?: string;
  releaseNotes?: string;
  supportUrl?: string;
  marketingUrl?: string;
  privacyUrl?: string;
  copyright?: string;
  primaryCategory?: string;
  secondaryCategory?: string;
}

/** Per-locale listing text; anything missing falls back to the primary listing */
export type LocalizedListing = Partial<
  Pick<ListingConfig, "name" | "subtitle" | "promotionalText" | "description" | "keywords" | "releaseNotes">
> & {
  /** Screenshot captions keyed by shot raw name, plus "poster" for the poster subtitle */
  captions?: Record<string, Partial<Pick<ShotConfig, "title" | "subtitle">>>;
};

export interface TranslateConfig {
  /** App Store locales to fill; defaults to every locale App Store Connect supports */
  locales: string[];
  /** Terms copied verbatim, like the app's brand name */
  keep: string[];
  model: string;
  /** Folder holding one <locale>.json per translated listing */
  dir: string;
}

export interface ReviewConfig {
  firstName?: string;
  lastName?: string;
  phone?: string;
  email?: string;
  notes?: string;
}

export interface ThemeConfig {
  background: [string, string];
  accent: string;
  text: string;
  muted: string;
  font: string;
}

export interface ShotConfig {
  raw: string;
  title: [string, string];
  subtitle?: string;
}

export interface PosterConfig {
  raw: string;
  icon: string;
  title: string;
  subtitle?: string;
  /** In-plane rotation of the phone lying flat, in degrees */
  spin: number;
  /** Camera tilt toward the table, in degrees */
  tilt: number;
  /** Rendered phone width before placement; larger runs off the canvas */
  width: number;
  x: number;
  y: number;
  /** Visible edge thickness in source pixels */
  depth: number;
}

export interface ScreenshotsConfig {
  simulator: string;
  flow: string;
  dir: string;
  bezel: string;
  size: [number, number];
  theme: ThemeConfig;
  shots: ShotConfig[];
  poster?: PosterConfig;
}

export interface ShipConfig {
  cwd: string;
  bundleId: string;
  version: string;
  locale: string;
  listing: ListingConfig;
  localizations: Record<string, LocalizedListing>;
  translate: TranslateConfig;
  review?: ReviewConfig;
  /** App Store Connect age rating declaration, keyed by API attribute name */
  ageRating?: Record<string, string | boolean>;
  /** Answer to "Does your app contain, show, or access third-party content?" */
  usesThirdPartyContent?: boolean;
  /** fastlane app privacy JSON; [{ "data_protections": ["DATA_NOT_COLLECTED"] }] when nothing is collected */
  privacy?: unknown[];
  screenshots?: ScreenshotsConfig;
}

type RawConfig = Partial<Omit<ShipConfig, "screenshots" | "cwd" | "localizations" | "translate">> & {
  translate?: Partial<TranslateConfig>;
  screenshots?: Partial<Omit<ScreenshotsConfig, "theme" | "poster">> & {
    theme?: Partial<ThemeConfig>;
    poster?: Partial<PosterConfig> & Pick<PosterConfig, "raw" | "icon" | "title">;
  };
};

const DEFAULT_THEME: ThemeConfig = {
  background: ["#1D232B", "#0E1114"],
  accent: "#26DE81",
  text: "#FFFFFF",
  muted: "#A3ABB7",
  font: "System Font",
};

/** fastlane's list of App Store Connect metadata locales */
export const APP_STORE_LOCALES = [
  "ar-SA", "bn-BD", "ca", "cs", "da", "de-DE", "el", "en-AU", "en-CA", "en-GB", "en-US", "es-ES", "es-MX",
  "fi", "fr-CA", "fr-FR", "gu-IN", "he", "hi", "hr", "hu", "id", "it", "ja", "kn-IN", "ko", "ml-IN", "mr-IN",
  "ms", "nl-NL", "no", "or-IN", "pa-IN", "pl", "pt-BR", "pt-PT", "ro", "ru", "sk", "sl-SI", "sv", "ta-IN",
  "te-IN", "th", "tr", "uk", "ur-PK", "vi", "zh-Hans", "zh-Hant",
];

const DEFAULT_POSTER = { spin: -35, tilt: 50, width: 2900, x: -90, y: 330, depth: 60 };

export function expandPath(p: string, cwd: string): string {
  if (p.startsWith("~")) return path.join(os.homedir(), p.slice(1));
  return path.resolve(cwd, p);
}

function readJson<T>(file: string): T | undefined {
  if (!fs.existsSync(file)) return undefined;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function loadLocalizations(dir: string): Record<string, LocalizedListing> {
  if (!fs.existsSync(dir)) return {};
  return Object.fromEntries(
    fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => [path.basename(f, ".json"), JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"))])
  );
}

export function loadShipConfig(cwd: string): ShipConfig {
  const raw = readJson<RawConfig>(path.join(cwd, CONFIG_FILE));
  if (!raw) throw new Error(`No ${CONFIG_FILE} found in ${cwd}`);
  if (!raw.listing?.name || !raw.listing.description) {
    throw new Error(`${CONFIG_FILE} needs listing.name and listing.description`);
  }

  const appJson = readJson<{ expo?: { version?: string; ios?: { bundleIdentifier?: string } } }>(
    path.join(cwd, "app.json")
  );
  const bundleId = raw.bundleId ?? appJson?.expo?.ios?.bundleIdentifier;
  const version = raw.version ?? appJson?.expo?.version;
  if (!bundleId) throw new Error("No bundle id: set ios.bundleIdentifier in app.json or bundleId in ship.config.json");
  if (!version) throw new Error("No app version: set version in app.json or ship.config.json");

  const shots = raw.screenshots;
  const screenshots: ScreenshotsConfig | undefined = shots && {
    simulator: shots.simulator ?? "iPhone 17 Pro Max",
    flow: expandPath(shots.flow ?? "ship/screenshots.yaml", cwd),
    dir: expandPath(shots.dir ?? "ship/screenshots", cwd),
    bezel: expandPath(shots.bezel ?? "", cwd),
    size: shots.size ?? [1320, 2868],
    theme: { ...DEFAULT_THEME, ...shots.theme },
    shots: shots.shots ?? [],
    poster: shots.poster && {
      ...DEFAULT_POSTER,
      ...shots.poster,
      icon: expandPath(shots.poster.icon, cwd),
    },
  };

  const locale = raw.locale ?? "en-US";
  const translate: TranslateConfig = {
    locales: (raw.translate?.locales ?? APP_STORE_LOCALES).filter((l) => l !== locale),
    keep: raw.translate?.keep ?? [],
    model: raw.translate?.model ?? "claude-opus-5-5",
    dir: expandPath(raw.translate?.dir ?? "ship/listing", cwd),
  };

  return {
    cwd,
    bundleId,
    version,
    locale,
    listing: raw.listing,
    localizations: loadLocalizations(translate.dir),
    translate,
    review: raw.review,
    ageRating: raw.ageRating,
    usesThirdPartyContent: raw.usesThirdPartyContent,
    privacy: raw.privacy,
    screenshots,
  };
}

export function requireScreenshots(config: ShipConfig): ScreenshotsConfig {
  if (!config.screenshots) throw new Error(`${CONFIG_FILE} has no "screenshots" section`);
  return config.screenshots;
}
