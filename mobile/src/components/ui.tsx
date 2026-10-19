import { useEffect, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Animated,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useTheme, type StatusColor } from '@/lib/theme';

export function Dot({ color, size = 10 }: { color: StatusColor; size?: number }) {
  const t = useTheme();
  const [pulse] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (color !== 'red') return;
    const loop = Animated.loop(Animated.timing(pulse, { toValue: 1, duration: 1600, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [color, pulse]);

  const fill = t[color];
  return (
    <View style={{ width: size, height: size }}>
      {color === 'red' && (
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            {
              borderRadius: size,
              backgroundColor: fill,
              opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0] }),
              transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 2.4] }) }],
            },
          ]}
        />
      )}
      <View style={{ width: size, height: size, borderRadius: size, backgroundColor: fill }} />
    </View>
  );
}

export function Card({
  children,
  tone,
  style,
}: {
  children: ReactNode;
  tone?: 'danger' | 'warn';
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  const border = tone === 'danger' ? t.red : tone === 'warn' ? t.amber : t.border;
  return (
    <View
      style={[
        {
          backgroundColor: t.panel,
          borderColor: tone ? border + '99' : border,
          borderWidth: 1,
          borderRadius: 12,
          padding: 12,
        },
        tone === 'danger' && { backgroundColor: mix(t.panel, t.red) },
        style,
      ]}
    >
      {children}
    </View>
  );
}

// Rough "8% red over panel" tint without a colour library.
function mix(base: string, over: string): string {
  const p = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const [a, b] = [p(base), p(over)];
  return `rgb(${a.map((v, i) => Math.round(v * 0.9 + b[i] * 0.1)).join(',')})`;
}

export function SectionHeader({ title, hint }: { title: string; hint?: string }) {
  const t = useTheme();
  return (
    <View style={styles.sectionHeader}>
      <Text style={[styles.sectionTitle, { color: t.muted }]}>{title}</Text>
      {hint ? <Text style={{ color: t.muted, fontSize: 12 }}>{hint}</Text> : null}
    </View>
  );
}

export function Button({
  title,
  onPress,
  variant = 'default',
  disabled,
  busy,
  small,
}: {
  title: string;
  onPress: () => void;
  variant?: 'default' | 'primary' | 'danger' | 'ghost';
  disabled?: boolean;
  busy?: boolean;
  small?: boolean;
}) {
  const t = useTheme();
  const colors = {
    default: { bg: t.panel2, fg: t.text, border: t.border },
    primary: { bg: t.blue, fg: '#0b1220', border: t.blue },
    danger: { bg: 'transparent', fg: t.red, border: t.red + '88' },
    ghost: { bg: 'transparent', fg: t.text, border: t.border },
  }[variant];
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      style={({ pressed }) => [
        styles.button,
        small && styles.buttonSmall,
        { backgroundColor: colors.bg, borderColor: colors.border, opacity: disabled ? 0.5 : pressed ? 0.75 : 1 },
      ]}
    >
      {busy ? (
        <ActivityIndicator size="small" color={colors.fg} />
      ) : (
        <Text style={{ color: colors.fg, fontWeight: '600', fontSize: small ? 13 : 15 }}>{title}</Text>
      )}
    </Pressable>
  );
}

export function Chip({ label }: { label: string }) {
  const t = useTheme();
  return (
    <View style={[styles.chip, { backgroundColor: t.panel2, borderColor: t.border }]}>
      <Text style={{ color: t.muted, fontSize: 11 }}>{label}</Text>
    </View>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  const t = useTheme();
  return (
    <View style={[styles.segmented, { borderColor: t.border }]}>
      {options.map((o, i) => {
        const selected = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            style={[
              styles.segment,
              i > 0 && { borderLeftWidth: 1, borderLeftColor: t.border },
              selected && { backgroundColor: t.panel2 },
            ]}
          >
            <Text style={{ color: selected ? t.text : t.muted, fontWeight: selected ? '700' : '500', fontSize: 13 }}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginTop: 22,
    marginBottom: 10,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  button: {
    minHeight: 44,
    paddingHorizontal: 16,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonSmall: {
    minHeight: 32,
    paddingHorizontal: 10,
  },
  chip: {
    paddingHorizontal: 7,
    paddingVertical: 1,
    borderRadius: 999,
    borderWidth: 1,
  },
  segmented: {
    flexDirection: 'row',
    borderWidth: 1,
    borderRadius: 10,
    overflow: 'hidden',
  },
  segment: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 8,
  },
});
