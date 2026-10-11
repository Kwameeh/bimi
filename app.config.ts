import type { ConfigContext, ExpoConfig } from 'expo/config';

export default ({ config }: ConfigContext): ExpoConfig => {
  const owner = process.env.BIMI_EXPO_OWNER;
  const projectId = process.env.BIMI_EAS_PROJECT_ID;
  return {
    ...config,
    name: config.name ?? 'Bimi',
    slug: config.slug ?? 'bimi',
    ...(owner ? { owner } : {}),
    android: {
      ...config.android,
      ...(process.env.BIMI_ANDROID_PACKAGE ? { package: process.env.BIMI_ANDROID_PACKAGE } : {}),
    },
    ios: {
      ...config.ios,
      ...(process.env.BIMI_IOS_BUNDLE_IDENTIFIER
        ? { bundleIdentifier: process.env.BIMI_IOS_BUNDLE_IDENTIFIER }
        : {}),
    },
    extra: { ...config.extra, ...(projectId ? { eas: { projectId } } : {}) },
  };
};
