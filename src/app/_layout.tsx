import '@/global.css';

import { ConvexProvider } from 'convex/react';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { HeroUINativeProvider } from 'heroui-native';
import React from 'react';
import { useColorScheme } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { initialWindowMetrics, SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';

import { VoiceHotkey } from '@/components/voice/voice-hotkey';
import { convex } from '@/lib/convex';
import { usePushTokenRegistration } from '@/lib/use-push-token';

function PushBootstrap() {
  usePushTokenRegistration();
  return null;
}

export default function RootLayout() {
  const colorScheme = useColorScheme();

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider initialMetrics={initialWindowMetrics}>
        <ConvexProvider client={convex}>
          <HeroUINativeProvider>
            <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
              <StatusBar style="auto" />
              <PushBootstrap />
              <VoiceHotkey />
              <Stack
                screenOptions={{
                  animation: 'slide_from_right',
                  animationDuration: 240,
                  headerShown: false,
                  contentStyle: { backgroundColor: 'transparent' },
                }}>
                <Stack.Screen name="(tabs)" />
                <Stack.Screen name="chat/[contactId]" />
                <Stack.Screen name="contact/[contactId]" />
                <Stack.Screen name="approvals" />
                <Stack.Screen name="memory" />
                <Stack.Screen name="contacts" />
                <Stack.Screen
                  name="search"
                  options={{
                    animation: 'slide_from_bottom',
                    presentation: 'modal',
                  }}
                />
                <Stack.Screen
                  name="media/[messageId]"
                  options={{
                    animation: 'fade',
                    presentation: 'transparentModal',
                  }}
                />
                <Stack.Screen
                  name="new-chat"
                  options={{
                    animation: 'slide_from_bottom',
                    presentation: 'modal',
                  }}
                />
                <Stack.Screen
                  name="voice"
                  options={{
                    animation: 'fade',
                    presentation: 'fullScreenModal',
                  }}
                />
              </Stack>
            </ThemeProvider>
          </HeroUINativeProvider>
        </ConvexProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
