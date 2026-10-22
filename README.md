# expo-local-ship

CLI to build and submit Expo apps locally.

- **iOS** submits via `xcrun altool` using an App Store Connect API key — fast, reliable, fully automated.
- **Android** submits via `eas submit`.

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
