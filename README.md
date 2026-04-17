# expo-local-ship

CLI to build and submit Expo apps locally via EAS.

## Requirements

Your project must have:

- A `production-local` build profile in `eas.json` with `credentialsSource: "local"`
- A `credentials.json` with local signing credentials ([docs](https://docs.expo.dev/app-signing/local-credentials/))
- `eas` CLI installed (`npm install -g eas-cli`)

Optional: a `ship:prebuild` script in `package.json` for any steps that need to run before the build (e.g. swapping credentials files, setting provisioning profiles, compiling native plugins).

## Setup

```bash
npm install -D @johnhaup/expo-local-ship
```

Add a script to `package.json`:

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
      "ios": {
        "ascAppId": "YOUR_APP_ID",
        "appleId": "you@example.com",
        "appleTeamId": "YOUR_TEAM_ID"
      }
    }
  }
}
```

## Usage

```bash
# Build + submit
bun ship:ios
bun ship:android

# Or run directly with platform as argument
npx expo-local-ship ios
npx expo-local-ship android
npx expo-local-ship both

# Build only, skip submission
npx expo-local-ship ios --no-submit
```

If no platform argument is provided, you'll be prompted to choose.

## How it works

1. Validates `eas.json` has a `production-local` profile and `credentials.json` exists
2. Runs `ship:prebuild` script if present in your `package.json`
3. Runs `eas build --profile production-local --local --output ./build/...`
4. Submits the artifact via `eas submit --profile production` (unless `--no-submit`)

Build artifacts are saved to `./build/` in your project root.
