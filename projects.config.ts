const HOME = process.env.HOME ?? "/Users/johnhaupenthal";
const PROJECTS = `${HOME}/Projects`;

export interface PreBuildStep {
  label: string;
  command: string;
  args: string[];
}

export interface PlatformConfig {
  /** Profile name in the project's eas.json */
  buildProfile: string;
  /** Output artifact path, relative to project root */
  outputPath: string;
  /** Steps run in project root before `eas build` */
  preBuildSteps?: PreBuildStep[];
}

export interface ProjectConfig {
  name: string;
  path: string;
  ios?: PlatformConfig;
  android?: PlatformConfig;
}

export const projects: ProjectConfig[] = [
  {
    name: "Boxing Buddy",
    path: `${PROJECTS}/boxing-buddy`,
    ios: {
      buildProfile: "production-local",
      outputPath: "build/ios-archive.tar.gz",
      // Requires: credentials.json with local certs + provisioning profile.
      // See eas.json production-local profile (credentialsSource: local).
    },
  },
  {
    name: "Paperweight",
    path: `${PROJECTS}/paperweight`,
    ios: {
      buildProfile: "production",
      outputPath: "build/ios-archive.tar.gz",
      preBuildSteps: [
        {
          label: "Switch to production credentials",
          command: "npm",
          args: ["run", "creds:prod"],
        },
      ],
    },
    android: {
      buildProfile: "production",
      outputPath: "build/android-prod.aab",
      preBuildSteps: [
        {
          label: "Switch to production credentials",
          command: "npm",
          args: ["run", "creds:prod"],
        },
      ],
    },
  },
  {
    name: "Sonic Stream",
    path: `${PROJECTS}/sonic-stream`,
    ios: {
      buildProfile: "production-local",
      outputPath: "build/ios-archive.tar.gz",
      preBuildSteps: [
        {
          label: "Set production provisioning profile",
          command: "bun",
          args: ["run", "provision:prod"],
        },
      ],
    },
    android: {
      buildProfile: "production-local",
      outputPath: "build/android-prod.aab",
    },
  },
  {
    name: "Daily Stoic",
    path: `${PROJECTS}/daily-stoic`,
    ios: {
      buildProfile: "production",
      outputPath: "build/ios-archive.tar.gz",
      preBuildSteps: [
        {
          label: "Compile native plugins",
          command: "npm",
          args: ["run", "gen:plugins"],
        },
      ],
    },
    android: {
      buildProfile: "production",
      outputPath: "build/android-prod.aab",
      preBuildSteps: [
        {
          label: "Compile native plugins",
          command: "npm",
          args: ["run", "gen:plugins"],
        },
      ],
    },
  },
];
