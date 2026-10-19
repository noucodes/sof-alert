import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from 'react-native';
import { Chip, Segmented } from '@/components/ui';
import { ago, category, firstLine, severity, sources, type Category } from '@/lib/format';
import { useStore } from '@/lib/store';
import { mono, useTheme } from '@/lib/theme';
import type { Alert } from '@/lib/types';
import { useNow } from '@/lib/useNow';

type Filter = 'all' | Category;

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'error', label: 'Errors' },
  { value: 'outage', label: 'Outages' },
  { value: 'info', label: 'Info' },
];

export default function AlertsScreen() {
  const t = useTheme();
  const { alerts, settings, syncing, syncError, refresh, markRead, ready } = useStore();
  const { focus } = useLocalSearchParams<{ focus?: string }>();
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  // Explicit open/closed choices; anything unset falls back to "open if it's
  // the alert a notification tap pointed at".
  const [toggled, setToggled] = useState<Map<string, boolean>>(new Map());
  const list = useRef<FlatList<Alert>>(null);
  const scrolledTo = useRef<string | null>(null);
  const now = useNow(); // keeps "5m ago" labels fresh

  // Alerts that arrive while this tab is open count as read.
  const newestId = alerts[0]?.id;
  useFocusEffect(
    useCallback(() => {
      if (newestId) markRead();
    }, [markRead, newestId]),
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return alerts.filter(
      (a) =>
        a.id === focus || // never hide the alert a notification opened
        ((filter === 'all' || category(a) === filter) &&
          (!q || a.title.toLowerCase().includes(q) || a.message.toLowerCase().includes(q))),
    );
  }, [alerts, filter, query, focus]);

  // Opened from a notification: scroll to the alert once it has synced.
  const focusIndex = focus ? visible.findIndex((a) => a.id === focus) : -1;
  useEffect(() => {
    if (focusIndex === -1 || scrolledTo.current === focus) return;
    scrolledTo.current = focus ?? null;
    list.current?.scrollToIndex({ index: focusIndex, animated: true, viewPosition: 0 });
  }, [focus, focusIndex]);

  const isOpen = (id: string) => toggled.get(id) ?? id === focus;
  const toggle = (id: string) => setToggled((prev) => new Map(prev).set(id, !isOpen(id)));

  if (ready && !settings.topic) {
    return (
      <View style={[styles.empty, { backgroundColor: t.bg }]}>
        <Text style={[styles.emptyTitle, { color: t.text }]}>Not set up yet</Text>
        <Text style={{ color: t.muted, textAlign: 'center' }}>
          Add your ntfy topic in Settings: the same one the agents publish to.
        </Text>
        <Pressable onPress={() => router.navigate('/settings')} style={{ marginTop: 16 }}>
          <Text style={{ color: t.blue, fontWeight: '600' }}>Open Settings</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <View style={[styles.toolbar, { borderBottomColor: t.border }]}>
        <Segmented options={FILTERS} value={filter} onChange={setFilter} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search alerts"
          placeholderTextColor={t.muted}
          style={[styles.search, { color: t.text, backgroundColor: t.panel2, borderColor: t.border }]}
          clearButtonMode="while-editing"
          autoCorrect={false}
        />
        {syncError ? <Text style={{ color: t.amber, fontSize: 12 }}>Sync failed: {syncError}</Text> : null}
      </View>

      <FlatList
        ref={list}
        data={visible}
        extraData={{ toggled, focus, now }}
        keyExtractor={(a) => a.id}
        contentContainerStyle={{ padding: 12, gap: 8, flexGrow: 1 }}
        refreshControl={<RefreshControl refreshing={syncing} onRefresh={refresh} tintColor={t.muted} colors={[t.blue]} />}
        onScrollToIndexFailed={({ index }) =>
          setTimeout(() => list.current?.scrollToIndex({ index, animated: true }), 300)
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={{ color: t.muted }}>
              {alerts.length ? 'No alerts match this filter.' : 'No alerts. Quiet is good.'}
            </Text>
          </View>
        }
        renderItem={({ item }) => <AlertRow alert={item} open={isOpen(item.id)} onPress={() => toggle(item.id)} />}
      />
    </View>
  );
}

function AlertRow({ alert, open, onPress }: { alert: Alert; open: boolean; onPress: () => void }) {
  const t = useTheme();
  const accent = { critical: t.red, error: t.amber, ok: t.green, info: t.blue }[severity(alert)];

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.alert,
        { backgroundColor: pressed ? t.panel2 : t.panel, borderColor: t.border, borderLeftColor: accent },
      ]}
    >
      <View style={styles.alertHead}>
        <Text style={[styles.alertTitle, { color: t.text }]} numberOfLines={open ? undefined : 1}>
          {alert.title}
        </Text>
        <Text style={{ color: t.muted, fontSize: 12 }}>{ago(alert.time)}</Text>
      </View>
      {sources(alert).length > 0 && (
        <View style={styles.chips}>
          {sources(alert).map((s) => (
            <Chip key={s} label={s} />
          ))}
        </View>
      )}
      {open ? (
        <View style={[styles.detail, { backgroundColor: t.bg, borderColor: t.border }]}>
          <Text selectable style={{ color: t.text, fontFamily: mono, fontSize: 12, lineHeight: 18 }}>
            {alert.message}
          </Text>
          <Text style={{ color: t.muted, fontSize: 11, marginTop: 8 }}>{new Date(alert.time).toLocaleString()}</Text>
        </View>
      ) : (
        <Text style={{ color: t.muted, fontSize: 13, marginTop: 3 }} numberOfLines={1}>
          {firstLine(alert.message)}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  toolbar: {
    padding: 12,
    gap: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  search: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 15,
  },
  alert: {
    borderWidth: 1,
    borderLeftWidth: 3,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  alertHead: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  alertTitle: {
    flex: 1,
    fontSize: 15,
    fontWeight: '700',
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 5,
  },
  detail: {
    marginTop: 8,
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 6,
  },
});
