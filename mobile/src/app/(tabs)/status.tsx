import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Card, Dot, SectionHeader } from '@/components/ui';
import { ago, duration } from '@/lib/format';
import { useStore } from '@/lib/store';
import { useNow } from '@/lib/useNow';
import { useTheme, type StatusColor } from '@/lib/theme';
import type { CheckState } from '@/lib/types';

function checkColor(c: CheckState): StatusColor {
  if (c.status === 'down') return 'red';
  if (c.status === 'unknown') return 'grey';
  return c.error ? 'amber' : 'green';
}

export default function StatusScreen() {
  const t = useTheme();
  const { checks, agents, syncError, lastSyncAt, syncing, refresh, runChecks, settings } = useStore();

  const down = checks.filter((c) => c.status === 'down');
  const stale = agents.filter((a) => a.stale);
  const now = useNow();

  let overall: StatusColor = 'green';
  let headline = 'All systems normal';
  if (!settings.topic) {
    overall = 'grey';
    headline = 'Needs configuration';
  } else if (down.length) {
    overall = 'red';
    headline = `${down.length} service${down.length > 1 ? 's' : ''} down`;
  } else if (stale.length) {
    overall = 'red';
    headline = `${stale.length} agent${stale.length > 1 ? 's' : ''} silent`;
  } else if (syncError) {
    overall = 'grey';
    headline = 'Cannot reach ntfy';
  }

  return (
    <ScrollView
      style={{ backgroundColor: t.bg }}
      contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
      refreshControl={
        <RefreshControl
          refreshing={syncing}
          onRefresh={() => {
            refresh();
            runChecks();
          }}
          tintColor={t.muted}
          colors={[t.blue]}
        />
      }
    >
      <Card tone={overall === 'red' ? 'danger' : undefined} style={styles.hero}>
        <Dot color={overall} size={16} />
        <View style={{ flex: 1 }}>
          <Text style={[styles.headline, { color: t.text }]}>{headline}</Text>
          <Text style={{ color: t.muted, fontSize: 13 }}>
            {syncError ? syncError : lastSyncAt ? `Synced ${ago(lastSyncAt)}` : 'Syncing…'}
          </Text>
        </View>
      </Card>

      <SectionHeader title="Services" hint="checked from this phone" />
      <View style={{ gap: 8 }}>
        {checks.length ? (
          checks.map((c) => {
            const color = checkColor(c);
            return (
              <Card key={`${c.name}|${c.url}`} tone={c.status === 'down' ? 'danger' : color === 'amber' ? 'warn' : undefined}>
                <View style={styles.row}>
                  <Dot color={color} />
                  <Text style={[styles.name, { color: t.text }]}>{c.name}</Text>
                </View>
                <Text style={[styles.target, { color: t.muted }]} numberOfLines={1}>
                  {c.url}
                </Text>
                <View style={[styles.row, styles.foot]}>
                  <Text
                    style={{ flex: 1, fontSize: 12, color: c.status === 'down' ? t.red : color === 'amber' ? t.amber : t.muted }}
                    numberOfLines={2}
                  >
                    {c.status === 'down'
                      ? `Down ${duration(now - (c.downSince ?? now))} · ${c.error}`
                      : c.error
                        ? `Last check failed · ${c.error}`
                        : c.ms != null
                          ? `${c.ms} ms`
                          : 'waiting…'}
                  </Text>
                  <Text style={{ color: t.muted, fontSize: 12 }}>{c.lastCheckedAt ? ago(c.lastCheckedAt) : ''}</Text>
                </View>
              </Card>
            );
          })
        ) : (
          <Text style={{ color: t.muted, fontSize: 13 }}>
            No checks on this phone. Add /health URLs in Settings, or rely on the agents’ DOWN alerts.
          </Text>
        )}
      </View>

      <SectionHeader title="Agents" hint="heartbeat every 5 min" />
      <View style={{ gap: 8 }}>
        {agents.length ? (
          agents.map((a) => {
            const isStale = a.stale;
            return (
              <Card key={a.host} tone={isStale ? 'danger' : undefined}>
                <View style={styles.row}>
                  <Dot color={isStale ? 'red' : 'green'} />
                  <Text style={[styles.name, { color: t.text }]}>{a.host}</Text>
                  <Text style={{ color: isStale ? t.red : t.muted, fontSize: 12 }}>{ago(a.lastSeen)}</Text>
                </View>
              </Card>
            );
          })
        ) : (
          <Text style={{ color: t.muted, fontSize: 13 }}>
            No heartbeats yet. Start the agent on EC2 and on the bridge PC.
          </Text>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  hero: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 16,
  },
  headline: {
    fontSize: 20,
    fontWeight: '700',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  name: {
    flex: 1,
    fontSize: 15,
    fontWeight: '700',
  },
  target: {
    fontSize: 12,
    marginTop: 2,
    marginLeft: 18,
  },
  foot: {
    marginTop: 6,
    marginLeft: 18,
  },
});
