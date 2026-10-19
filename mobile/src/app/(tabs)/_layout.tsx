import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router';
import type { ColorValue } from 'react-native';
import { useStore } from '@/lib/store';
import { useTheme } from '@/lib/theme';

function icon(name: React.ComponentProps<typeof Ionicons>['name']) {
  // Tint colours come from our theme, so they're always strings.
  return function TabIcon({ color, size }: { color: ColorValue; size: number }) {
    return <Ionicons name={name} size={size} color={color as string} />;
  };
}

export default function TabLayout() {
  const t = useTheme();
  const { unread, checks, agents } = useStore();
  const problems = checks.filter((c) => c.status === 'down').length + agents.filter((a) => a.stale).length;

  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: t.panel },
        headerTintColor: t.text,
        headerTitleStyle: { fontWeight: '700' },
        headerShadowVisible: false,
        sceneStyle: { backgroundColor: t.bg },
        tabBarStyle: { backgroundColor: t.panel, borderTopColor: t.border },
        tabBarActiveTintColor: t.text,
        tabBarInactiveTintColor: t.muted,
        tabBarBadgeStyle: { backgroundColor: t.red, color: '#fff', fontSize: 11 },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Alerts',
          tabBarBadge: unread ? (unread > 99 ? '99+' : unread) : undefined,
          tabBarIcon: icon("notifications-outline"),
        }}
      />
      <Tabs.Screen
        name="status"
        options={{
          title: 'Status',
          tabBarBadge: problems || undefined,
          tabBarIcon: icon("pulse-outline"),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: icon("settings-outline"),
        }}
      />
    </Tabs>
  );
}
