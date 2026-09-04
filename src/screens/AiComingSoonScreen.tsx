import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppHeader } from '../components/AppHeader';
import { colors } from '../theme/colors';
import { radius, spacing } from '../theme/spacing';
import { typography } from '../theme/typography';

export function AiComingSoonScreen() {
  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <AppHeader title="AI Assistant" subtitle="Coming soon" />
      <View style={styles.content}>
        <View style={styles.icon}><Ionicons name="sparkles-outline" size={34} color={colors.primary} /></View>
        <Text style={styles.title}>AI Assistant</Text>
        <Text style={styles.message}>We’re still working on deployment. The AI Assistant will be available in a future update.</Text>
        <Text style={styles.bangla}>AI Assistant ডেপ্লয়মেন্টের কাজ চলছে। ভবিষ্যৎ আপডেটে এটি ব্যবহার করা যাবে।</Text>
        <View style={styles.offlineCard}><Ionicons name="cloud-offline-outline" size={21} color={colors.primary} /><Text style={styles.offlineText}>All case-management features continue to work offline.</Text></View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background }, content: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.xxl },
  icon: { width: 72, height: 72, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.sm, borderRadius: radius.pill, backgroundColor: colors.primarySoft },
  title: { ...typography.display, textAlign: 'center', color: colors.text }, message: { ...typography.body, maxWidth: 380, textAlign: 'center', color: colors.textMuted }, bangla: { ...typography.body, maxWidth: 380, textAlign: 'center', color: colors.text },
  offlineCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, maxWidth: 380, marginTop: spacing.lg, padding: spacing.lg, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surface }, offlineText: { ...typography.bodyStrong, flex: 1, color: colors.primary },
});
