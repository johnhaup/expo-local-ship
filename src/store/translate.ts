import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import chalk from "chalk";
import fs from "fs";
import path from "path";
import { z } from "zod";
import type { LocalizedListing, ShipConfig } from "./config";

const LOCALE_NAMES: Record<string, string> = {
  "ar-SA": "Arabic (Saudi Arabia)",
  "bn-BD": "Bangla (Bangladesh)",
  ca: "Catalan",
  cs: "Czech",
  da: "Danish",
  "de-DE": "German (Germany)",
  el: "Greek",
  "en-AU": "English (Australia)",
  "en-CA": "English (Canada)",
  "en-GB": "English (UK)",
  "en-US": "English (US)",
  "es-ES": "Spanish (Spain)",
  "es-MX": "Spanish (Mexico)",
  fi: "Finnish",
  "fr-CA": "French (Canada)",
  "fr-FR": "French (France)",
  "gu-IN": "Gujarati (India)",
  he: "Hebrew",
  hi: "Hindi",
  hr: "Croatian",
  hu: "Hungarian",
  id: "Indonesian",
  it: "Italian",
  ja: "Japanese",
  "kn-IN": "Kannada (India)",
  ko: "Korean",
  "ml-IN": "Malayalam (India)",
  "mr-IN": "Marathi (India)",
  ms: "Malay",
  "nl-NL": "Dutch (Netherlands)",
  no: "Norwegian Bokmål",
  "or-IN": "Odia (India)",
  "pa-IN": "Punjabi (India)",
  pl: "Polish",
  "pt-BR": "Portuguese (Brazil)",
  "pt-PT": "Portuguese (Portugal)",
  ro: "Romanian",
  ru: "Russian",
  sk: "Slovak",
  "sl-SI": "Slovenian",
  sv: "Swedish",
  "ta-IN": "Tamil (India)",
  "te-IN": "Telugu (India)",
  th: "Thai",
  tr: "Turkish",
  uk: "Ukrainian",
  "ur-PK": "Urdu (Pakistan)",
  vi: "Vietnamese",
  "zh-Hans": "Chinese (Simplified)",
  "zh-Hant": "Chinese (Traditional)",
};

/** App Store Connect field limits, in characters */
const LIMITS: Record<keyof LocalizedListing, number> = {
  name: 30,
  subtitle: 30,
  promotionalText: 170,
  description: 4000,
  keywords: 100,
  releaseNotes: 4000,
};

const CONCURRENCY = 6;
const ATTEMPTS = 3;

const ListingSchema = z.object({
  name: z.string(),
  subtitle: z.string(),
  promotionalText: z.string(),
  description: z.string(),
  keywords: z.string(),
  releaseNotes: z.string(),
});

type Listing = z.infer<typeof ListingSchema>;

function sourceListing(config: ShipConfig): Partial<Listing> {
  const { name, subtitle, promotionalText, description, keywords, releaseNotes } = config.listing;
  return { name, subtitle, promotionalText, description, keywords, releaseNotes };
}

function overLimit(listing: Listing): string[] {
  return Object.entries(LIMITS).flatMap(([key, max]) => {
    const length = [...listing[key as keyof Listing]].length;
    return length > max ? [`${key} is ${length} characters; the limit is ${max}`] : [];
  });
}

function buildPrompt(config: ShipConfig, locale: string): string {
  const language = LOCALE_NAMES[locale] ?? locale;
  const keep = config.translate.keep.map((t) => `"${t}"`).join(", ");
  const limits = Object.entries(LIMITS)
    .map(([key, max]) => `${key} ≤ ${max}`)
    .join(", ");

  return [
    `Localize this App Store listing from ${LOCALE_NAMES[config.locale] ?? config.locale} into ${language} for the ${locale} storefront.`,
    "Write it the way a native speaker writing App Store copy would, not word for word. Keep the meaning, tone, formatting and line breaks.",
    ...(keep ? [`Keep these exactly as written, untranslated: ${keep}.`] : []),
    "keywords: comma-separated with no spaces after commas; choose the terms people in this storefront would search for, not a literal translation of each English keyword, and don't repeat words already in the name.",
    `Hard character limits: ${limits}. Shorten rather than exceed them.`,
    "",
    JSON.stringify(sourceListing(config), null, 2),
  ].join("\n");
}

async function translateLocale(client: Anthropic, config: ShipConfig, locale: string): Promise<Listing> {
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: buildPrompt(config, locale) }];

  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    const response = await client.beta.messages.parse({
      model: config.translate.model,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium", format: betaZodOutputFormat(ListingSchema) },
      messages,
    });
    if (response.stop_reason === "refusal") throw new Error(`${locale}: request was declined`);
    const listing = response.parsed_output;
    if (!listing) throw new Error(`${locale}: response was not valid JSON (${response.stop_reason})`);

    const problems = overLimit(listing);
    if (problems.length === 0) return listing;

    messages.push(
      { role: "assistant", content: response.content },
      { role: "user", content: `Too long: ${problems.join("; ")}. Return the full listing again with those fields shortened.` }
    );
  }
  throw new Error(`${locale}: still over App Store limits after ${ATTEMPTS} attempts`);
}

async function inBatches<T>(items: T[], size: number, fn: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(size, queue.length) }, async () => {
    for (let item = queue.shift(); item !== undefined; item = queue.shift()) await fn(item);
  });
  await Promise.all(workers);
}

export async function translateListing(
  config: ShipConfig,
  { force, only }: { force: boolean; only?: string[] }
): Promise<void> {
  const { translate } = config;
  const requested = only ?? translate.locales;
  const unknown = requested.filter((l) => !LOCALE_NAMES[l]);
  if (unknown.length) throw new Error(`Unknown App Store locale(s): ${unknown.join(", ")}`);

  const pending = requested.filter((l) => force || only || !config.localizations[l]);
  if (pending.length === 0) {
    console.log(chalk.green(`  ✓ All ${requested.length} locales already translated (use --force to redo)`));
    return;
  }

  console.log(chalk.blue(`\n🌍 Translating the listing into ${pending.length} locale(s) with ${translate.model}`));
  fs.mkdirSync(translate.dir, { recursive: true });
  const client = new Anthropic();
  const failed: string[] = [];

  await inBatches(pending, CONCURRENCY, async (locale) => {
    try {
      const listing = await translateLocale(client, config, locale);
      fs.writeFileSync(path.join(translate.dir, `${locale}.json`), JSON.stringify(listing, null, 2) + "\n");
      console.log(chalk.dim(`  ✓ ${locale.padEnd(8)} ${listing.name} — ${listing.subtitle}`));
    } catch (err) {
      failed.push(locale);
      console.log(chalk.red(`  ✗ ${locale}: ${err instanceof Error ? err.message : err}`));
    }
  });

  if (failed.length) throw new Error(`Translation failed for ${failed.join(", ")}; rerun to retry just those`);
  console.log(chalk.green(`  ✓ ${pending.length} listings → ${translate.dir}`));
}
