import * as Notifications from 'expo-notifications';
import { Stack, router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { Platform } from 'react-native';
import { StoreProvider, useStore } from '@/lib/store';
import { useTheme } from '@/lib/theme';

// Show alerts as banners even while the app is open.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

function NotificationBridge() {
  const { refresh } = useStore();
  const response = Notifications.useLastNotificationResponse();

  // Tapping a notification opens the Alerts tab with that alert expanded.
  useEffect(() => {
    if (!response) return;
    const id = response.notification.request.content.data?.id;
    refresh();
    router.navigate(typeof id === 'string' ? { pathname: '/', params: { focus: id } } : '/');
  }, [response, refresh]);

  useEffect(() => {
    const sub = Notifications.addNotificationReceivedListener(() => refresh());
    return () => sub.remove();
  }, [refresh]);

  return null;
}

export default function RootLayout() {
  const t = useTheme();
  return (
    <StoreProvider>
      {/* notification responses have no web implementation (browser preview) */}
      {Platform.OS !== 'web' && <NotificationBridge />}
      <StatusBar style="auto" />
      <Stack screenOptions={{ contentStyle: { backgroundColor: t.bg } }}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      </Stack>
    </StoreProvider>
  );
}
