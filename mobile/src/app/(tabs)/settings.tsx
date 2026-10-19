import { useState } from 'react';
import { Alert as Dialog, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { Button, Card, SectionHeader } from '@/components/ui';
import { useStore } from '@/lib/store';
import { useTheme } from '@/lib/theme';
import type { CheckConfig, PushState, Settings } from '@/lib/types';

export default function SettingsScreen() {
  const t = useTheme();
  const { settings } = useStore();
  // Remount the form (resetting its draft) whenever the saved values change.
  const formKey = JSON.stringify([settings.server, settings.topic, settings.token, settings.checks]);

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        style={{ backgroundColor: t.bg }}
        contentContainerStyle={{ padding: 16, paddingBottom: 48 }}
        keyboardShouldPersistTaps="handled"
      >
        <ConnectionForm key={formKey} />
        <PushSection />
        <DataSection />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// The push switch saves immediately, so it lives outside this draft and
// toggling it never discards unsaved edits here.
function ConnectionForm() {
  const t = useTheme();
  const { settings, saveSettings } = useStore();
  const [draft, setDraft] = useState<Settings>(settings);
  const [saving, setSaving] = useState(false);

  const dirty = JSON.stringify({ ...draft, pushEnabled: settings.pushEnabled }) !== JSON.stringify(settings);
  const set = (patch: Partial<Settings>) => setDraft((d) => ({ ...d, ...patch }));
  const setCheck = (i: number, patch: Partial<CheckConfig>) =>
    set({ checks: draft.checks.map((c, j) => (j === i ? { ...c, ...patch } : c)) });

  const save = async () => {
    const checks = draft.checks
      .filter((c) => c.url.trim())
      .map((c) => ({ name: c.name.trim() || c.url.trim(), url: c.url.trim() }));
    setSaving(true);
    try {
      await saveSettings({ ...draft, checks, pushEnabled: settings.pushEnabled });
    } finally {
      setSaving(false);
    }
  };

  const inputStyle = [styles.input, { color: t.text, backgroundColor: t.panel2, borderColor: t.border }];

  return (
    <>
      <SectionHeader title="Connection" />
      <Card style={{ gap: 12 }}>
        <Field label="ntfy server">
          <TextInput
            value={draft.server}
            onChangeText={(server) => set({ server })}
            style={inputStyle}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            placeholder="https://ntfy.sh"
            placeholderTextColor={t.muted}
          />
        </Field>
        <Field label="Topic" hint="The same private topic as in the agent configs">
          <TextInput
            value={draft.topic}
            onChangeText={(topic) => set({ topic })}
            style={inputStyle}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="sof-alerts-…"
            placeholderTextColor={t.muted}
          />
        </Field>
        <Field label="Access token" hint="Only for a self-hosted ntfy with auth">
          <TextInput
            value={draft.token}
            onChangeText={(token) => set({ token })}
            style={inputStyle}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            placeholder="optional"
            placeholderTextColor={t.muted}
          />
        </Field>
      </Card>

      <SectionHeader title="Health checks" hint="run while the app is open" />
      <Card style={{ gap: 12 }}>
        {draft.checks.map((c, i) => (
          <View key={i} style={{ gap: 6 }}>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TextInput
                value={c.name}
                onChangeText={(name) => setCheck(i, { name })}
                style={[inputStyle, { flex: 1 }]}
                placeholder="Name (e.g. sof-main)"
                placeholderTextColor={t.muted}
              />
              <Button
                small
                variant="danger"
                title="Remove"
                onPress={() => set({ checks: draft.checks.filter((_, j) => j !== i) })}
              />
            </View>
            <TextInput
              value={c.url}
              onChangeText={(url) => setCheck(i, { url })}
              style={inputStyle}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              placeholder="https://…/health"
              placeholderTextColor={t.muted}
            />
          </View>
        ))}
        <Button variant="ghost" title="Add check" onPress={() => set({ checks: [...draft.checks, { name: '', url: '' }] })} />
      </Card>

      <View style={{ marginTop: 16 }}>
        <Button variant="primary" title={dirty ? 'Save changes' : 'Saved'} onPress={save} disabled={!dirty} busy={saving} />
      </View>
    </>
  );
}

function PushSection() {
  const t = useTheme();
  const { settings, saveSettings, push, registerPush, sendTest } = useStore();
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  const test = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      await sendTest();
      setTestResult('Sent: a notification should appear in a few seconds.');
    } catch (err) {
      setTestResult(`Failed: ${(err as Error).message}`);
    } finally {
      setTesting(false);
    }
  };

  return (
    <>
      <SectionHeader title="Push notifications" />
      <Card style={{ gap: 12 }}>
        <View style={styles.switchRow}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: t.text, fontWeight: '600' }}>Receive alerts on this phone</Text>
            <Text style={{ color: t.muted, fontSize: 12 }}>{pushStatus(push)}</Text>
          </View>
          <Switch
            value={settings.pushEnabled}
            onValueChange={(pushEnabled) => saveSettings({ ...settings, pushEnabled })}
            trackColor={{ true: t.green, false: t.border }}
          />
        </View>
        {push.state === 'error' && <Text style={{ color: t.amber, fontSize: 13 }}>{push.error}</Text>}
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Button title="Send test" onPress={test} busy={testing} disabled={push.state !== 'registered'} />
          </View>
          <View style={{ flex: 1 }}>
            <Button variant="ghost" title="Re-register" onPress={registerPush} busy={push.state === 'registering'} />
          </View>
        </View>
        {testResult && (
          <Text style={{ color: testResult.startsWith('Sent') ? t.green : t.amber, fontSize: 13 }}>{testResult}</Text>
        )}
        <Text style={{ color: t.muted, fontSize: 12 }}>
          Android settings → Apps → SOF Alert → Notifications lets you tune each channel. “Service down” can bypass Do Not
          Disturb.
        </Text>
      </Card>
    </>
  );
}

function DataSection() {
  const { alerts, clearAlerts } = useStore();
  return (
    <>
      <SectionHeader title="Data" />
      <Button
        variant="danger"
        title={`Clear alert history (${alerts.length})`}
        disabled={!alerts.length}
        onPress={() =>
          Dialog.alert('Clear alert history?', 'Alerts are removed from this phone only.', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Clear', style: 'destructive', onPress: clearAlerts },
          ])
        }
      />
    </>
  );
}

function pushStatus(push: PushState): string {
  switch (push.state) {
    case 'registered':
      return 'Registered with the agents';
    case 'registering':
      return 'Registering…';
    case 'error':
      return 'Not registered';
    default:
      return 'Off';
  }
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  const t = useTheme();
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ color: t.text, fontWeight: '600', fontSize: 13 }}>{label}</Text>
      {children}
      {hint ? <Text style={{ color: t.muted, fontSize: 12 }}>{hint}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 15,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
});
