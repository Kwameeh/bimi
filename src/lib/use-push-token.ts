import { useMutation } from 'convex/react';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';

import { api } from '../../convex/_generated/api';

import { useInstance } from './instance';

let didRun = false;
let didMarkOpen = false;

export function usePushTokenRegistration() {
  const instance = useInstance();
  const registerPushToken = useMutation(api.userPreferences.registerPushToken);
  const markAppOpened = useMutation(api.userPreferences.markAppOpened);
  const ranForInstance = useRef<string | null>(null);

  useEffect(() => {
    if (!instance) return;
    if (!didMarkOpen) {
      didMarkOpen = true;
      void markAppOpened({ instance }).catch(() => {
        // non-fatal
      });
    }
    if (didRun && ranForInstance.current === instance) return;
    if (Platform.OS === 'web') return;
    didRun = true;
    ranForInstance.current = instance;

    (async () => {
      try {
        // expo-notifications throws at load time in Expo Go on Android
        // (remote push was removed from Expo Go in SDK 53), so skip there
        // and lazy-import the module everywhere else.
        const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
        if (isExpoGo && Platform.OS === 'android') {
          console.warn(
            'Push token registration skipped: not supported in Expo Go on Android. Use a development build.',
          );
          return;
        }
        const Notifications = await import('expo-notifications');

        const existing = await Notifications.getPermissionsAsync();
        let status = existing.status;
        if (status !== 'granted') {
          const requested = await Notifications.requestPermissionsAsync();
          status = requested.status;
        }
        if (status !== 'granted') return;

        const projectId =
          Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;

        const tokenResponse = projectId
          ? await Notifications.getExpoPushTokenAsync({ projectId })
          : await Notifications.getExpoPushTokenAsync();

        const token = tokenResponse?.data;
        if (typeof token === 'string' && token.length > 0) {
          await registerPushToken({ instance, token });
        }
      } catch (err) {
        // Non-fatal: dev builds without EAS config may fail here.
        console.warn('Push token registration skipped:', err);
      }
    })();
  }, [instance, registerPushToken, markAppOpened]);
}
