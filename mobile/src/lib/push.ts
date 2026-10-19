import {
  AndroidImportance,
  AndroidNotificationVisibility,
  getExpoPushTokenAsync,
  getPermissionsAsync,
  requestPermissionsAsync,
  setNotificationChannelAsync,
} from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

// Channel ids must match agent/src/expo-push.js (channelFor).
export async function setupChannels() {
  if (Platform.OS !== 'android') return;
  await setNotificationChannelAsync('outages', {
    name: 'Service down',
    description: 'A server or the bridge stopped responding',
    importance: AndroidImportance.MAX,
    bypassDnd: true,
    vibrationPattern: [0, 400, 200, 400, 200, 400],
    lightColor: '#ef4444',
    lockscreenVisibility: AndroidNotificationVisibility.PUBLIC,
  });
  await setNotificationChannelAsync('errors', {
    name: 'Log errors',
    description: 'Errors written to the sof-* logs',
    importance: AndroidImportance.HIGH,
    vibrationPattern: [0, 250],
    lightColor: '#f59e0b',
  });
  await setNotificationChannelAsync('info', {
    name: 'Recoveries & info',
    description: 'Recoveries, repeated-error summaries, agent start/stop',
    importance: AndroidImportance.DEFAULT,
  });
}

export function projectId(): string | undefined {
  return Constants?.expoConfig?.extra?.eas?.projectId ?? Constants?.easConfig?.projectId;
}

export async function getPushToken(): Promise<string> {
  if (!Device.isDevice) throw new Error('Push needs a real phone (or an emulator with Google Play).');
  const id = projectId();
  if (!id) throw new Error('No EAS project id — run "npx eas-cli init" in mobile/ and rebuild.');

  let { status } = await getPermissionsAsync();
  if (status !== 'granted') ({ status } = await requestPermissionsAsync());
  if (status !== 'granted') throw new Error('Notification permission was denied. Enable it in Android settings.');

  try {
    return (await getExpoPushTokenAsync({ projectId: id })).data;
  } catch (err) {
    const message = (err as Error).message || String(err);
    if (/FirebaseApp|google-services|FCM|firebase/i.test(message)) {
      throw new Error('Firebase is not set up for this build — add google-services.json and rebuild (see README).');
    }
    throw err;
  }
}

export function deviceName(): string {
  return Device.deviceName || Device.modelName || 'Android phone';
}

// Sends a push straight to this phone through Expo — exercises the same
// path (Expo → FCM → device) the agents use.
export async function sendTestPush(token: string): Promise<void> {
  const res = await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      to: token,
      title: 'Test alert',
      body: 'Push notifications are working on this phone.',
      channelId: 'errors',
      priority: 'high',
      sound: 'default',
    }),
  });
  const body = await res.json().catch(() => ({}));
  const ticket = body?.data?.[0] ?? body?.data;
  if (!res.ok || ticket?.status === 'error') {
    throw new Error(ticket?.details?.error || ticket?.message || body?.errors?.[0]?.message || `HTTP ${res.status}`);
  }
}
