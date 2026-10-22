# expo-local-ship

CLI to build and submit Expo apps locally.

- **iOS** submits via `xcrun altool` using an App Store Connect API key — fast, reliable, fully automated.
- **Android** submits via `eas submit`.
- **App Store listing** — screenshots (capture, frame, upload), metadata, and review submission from one config file. See [App Store](#app-store).

## Requirements

- `eas` CLI installed (`npm install -g eas-cli`)
- A `production-local` build profile in `eas.json` with `credentialsSource: "local"`
- A `credentials.json` with local signing credentials ([docs](https://docs.expo.dev/app-signing/local-credentials/))

Optional: a `ship:prebuild` script in `package.json` for any steps that need to run before the build.

## Setup

```bash
npm install -D @johnhaup/expo-local-ship
```

Add scripts to `package.json`:

```json
{
  "scripts": {
    "ship:ios": "expo-local-ship ios",
    "ship:android": "expo-local-ship android"
  }
}
```

### Minimum `eas.json`

```json
{
  "build": {
    "production-local": {
      "credentialsSource": "local",
      "distribution": "store",
      "developmentClient": false,
      "autoIncrement": true
    }
  },
  "submit": {
    "production": {
      "android": {
        "serviceAccountKeyPath": "./path-to-service-account.json",
        "track": "internal"
      }
    }
  }
}
```

> The `submit.production` config is only needed for Android. iOS submission uses altool directly.

### iOS: App Store Connect API Key (one-time)

iOS submission uses `xcrun altool` with an App Store Connect API key. This is a **one-time setup** that works across all your apps.

Run the interactive setup:

```bash
npx expo-local-ship setup
```

This will:
1. Prompt for your **API Key ID** and **Issuer ID** (from [App Store Connect → Integrations → App Store Connect API](https://appstoreconnect.apple.com/access/integrations/api))
2. Prompt for the path to your `AuthKey_<KEY_ID>.p8` file and copy it to `~/.appstoreconnect/private_keys/`
3. Save your config to `~/.expo-local-ship.json`

<details>
<summary>Manual setup</summary>

1. Go to [App Store Connect → Users & Access → Integrations → App Store Connect API](https://appstoreconnect.apple.com/access/integrations/api)
2. Generate a new key with **Admin** or **App Manager** role
3. Note your **Issuer ID** and **Key ID**
4. Download the `AuthKey_<KEY_ID>.p8` file (you can only download it once)
5. Place the `.p8` file in `~/.appstoreconnect/private_keys/`

Then create `~/.expo-local-ship.json`:

```json
{
  "apiKey": "YOUR_KEY_ID",
  "apiIssuer": "YOUR_ISSUER_ID"
}
```

Alternatively, use environment variables:

```bash
export ASC_API_KEY=YOUR_KEY_ID
export ASC_API_ISSUER=YOUR_ISSUER_ID
```

Environment variables take precedence over the config file.

</details>

## Usage

```bash
# Build + submit iOS (via altool)
bun ship:ios

# Build + submit Android (via eas submit)
bun ship:android

# Build both platforms
npx expo-local-ship both

# Build only, skip submission
npx expo-local-ship ios --no-submit

# Build + open in Transporter app instead of altool
npx expo-local-ship ios --transporter
```

If no platform argument is provided, you'll be prompted to choose.

## How it works

1. Validates `eas.json` has a `production-local` profile and `credentials.json` exists
2. Runs `ship:prebuild` script if present in your `package.json`
3. Runs `eas build --profile production-local --local`
4. Submits the artifact:
   - **iOS**: `xcrun altool --upload-app` with your API key (or Transporter with `--transporter`)
   - **Android**: `eas submit --profile production`

Build artifacts are saved to `./build/` in your project root.

## App Store

Everything after the binary upload, driven by a `ship.config.json` in your project root and the same App Store Connect API key used for submission.

| Command | What it does | Auth |
| --- | --- | --- |
| `expo-local-ship doctor` | Checks tools, API key, and config | — |
| `expo-local-ship create` | Creates the app record in App Store Connect (`fastlane produce`) | Apple ID, once per app |
| `expo-local-ship privacy` | Publishes App Privacy answers | Apple ID, once per app |
| `expo-local-ship metadata` | Uploads name, subtitle, description, keywords, URLs, categories, age rating, review contact, and every localized listing in `ship/listing/` | API key |
| `expo-local-ship screenshots` | `capture` then `frame` | — |
| `expo-local-ship screenshots capture [--build]` | Runs your Maestro flow on a simulator and saves raw screenshots | — |
| `expo-local-ship screenshots frame [--locales de-DE,ja]` | Composites raw screenshots into a device bezel with captions, plus an optional angled-phone poster, for the primary locale and every locale with its own captions | — |
| `expo-local-ship screenshots upload` | Syncs framed screenshots to App Store Connect (replaces what's there) | API key |
| `expo-local-ship review [--build <n>] [--auto-release]` | Attaches the build (latest by default) and submits for review | API key |

Apple's API keys can't create apps or answer App Privacy, so those two sign in with your Apple ID (set `APPLE_ID` or enter it when prompted; fastlane asks for the password and 2FA code).

### Requirements

- fastlane ≥ 2.241 (first version that accepts 1320×2868 screenshots), ImageMagick 7, librsvg, Maestro
- A device bezel PNG with a transparent screen (e.g. Apple's [product bezels](https://developer.apple.com/design/resources/#product-bezels)); the screen area is detected automatically

### Demo data for screenshots

`screenshots capture --build` makes a Release build with `EXPO_PUBLIC_STORE_DEMO=1` and installs it on the simulator. Give the app a deep link that loads sample data only when that flag is set, and open it at the start of your flow:

```tsx
// app/demo.tsx
const IS_STORE_DEMO = process.env.EXPO_PUBLIC_STORE_DEMO === "1";

export default function DemoScreen() {
  useEffect(() => {
    if (IS_STORE_DEMO) useStore.setState(buildDemoData(new Date()));
  }, []);
  return <Redirect href="/" />;
}
```

The status bar is set to 9:41 with full signal and battery while capturing. Each `takeScreenshot: <name>` in the flow becomes `<dir>/raw/<name>.png`.

### Localized listings

Put one JSON file per App Store locale in `ship/listing/<locale>.json` (e.g. `de-DE.json`, `ja.json`) with any of `name`, `subtitle`, `promotionalText`, `description`, `keywords` and `releaseNotes`; missing fields fall back to the primary listing, and URLs are always shared. Mind App Store Connect's limits: 30 characters for name and subtitle, 170 for promotional text, 100 for keywords.

Add a `captions` block to a locale file to frame its screenshots with translated text. Keys are shot `raw` names, plus `poster` for the poster subtitle; anything left out uses the primary caption, and lines that are too wide are scaled down to fit:

```json
"captions": {
  "poster": { "subtitle": "Rechnungen um jeden Zahltag planen" },
  "paychecks": { "title": ["Wissen, was bleibt", "nach jedem Zahltag"], "subtitle": "…" }
}
```

Locales without captions show the primary locale's screenshots.

### `ship.config.json`

```jsonc
{
  "locale": "en-US",
  "listing": {
    "name": "My App",
    "subtitle": "…",
    "promotionalText": "…",
    "description": "…",
    "keywords": "comma,separated",
    "releaseNotes": "…",
    "supportUrl": "https://…",
    "privacyUrl": "https://…",
    "copyright": "2026 Your Name",
    "primaryCategory": "FINANCE",
    "secondaryCategory": "PRODUCTIVITY"
  },
  // optional: where localized listings live
  "listingDir": "ship/listing",
  "review": { "firstName": "…", "lastName": "…", "phone": "…", "email": "…", "notes": "…" },
  // App Store Connect ageRatingDeclaration attributes
  "ageRating": { "violenceRealistic": "NONE", "unrestrictedWebAccess": false },
  // "Does your app contain, show, or access third-party content?" (required before review)
  "usesThirdPartyContent": false,
  // fastlane app privacy JSON
  "privacy": [{ "data_protections": ["DATA_NOT_COLLECTED"] }],
  "screenshots": {
    "simulator": "iPhone 17 Pro Max",
    "flow": "ship/screenshots.yaml",
    "dir": "ship/screenshots",
    "bezel": "~/path/to/iPhone Pro Max - Portrait.png",
    "size": [1320, 2868],
    "theme": { "background": ["#1D232B", "#0E1114"], "accent": "#26DE81", "text": "#FFFFFF", "muted": "#A3ABB7", "font": "System Font" },
    "poster": {
      "raw": "home",
      "icon": "assets/icon.png",
      "title": "My App",
      "subtitle": "…",
      // optional: spin, tilt (degrees), width, x, y (placement), depth (edge thickness)
    },
    "shots": [
      { "raw": "home", "title": ["First line", "accent line"], "subtitle": "…" }
    ]
  }
}
```

`bundleId` and `version` come from `app.json` unless set here. Framed output goes to `<dir>/framed/<locale>/`: the poster as `00-poster.png`, then shots in order.

Suggested scripts:

```json
{
  "store:doctor": "expo-local-ship doctor",
  "store:metadata": "expo-local-ship metadata",
  "store:screenshots": "expo-local-ship screenshots",
  "store:screenshots:upload": "expo-local-ship screenshots upload",
  "store:review": "expo-local-ship review"
}
```
