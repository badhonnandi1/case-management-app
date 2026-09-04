import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors } from '../../theme/colors';
import { radius, spacing } from '../../theme/spacing';
import { typography } from '../../theme/typography';
import { formatCitationPages } from '../../utils/aiUi';

interface SourceCitationProps {
  caseNumber: string;
  documentName: string;
  pageStart: number;
  pageEnd: number;
  onPress: () => void;
}

export function SourceCitation({ caseNumber, documentName, pageStart, pageEnd, onPress }: SourceCitationProps) {
  const pages = formatCitationPages(pageStart, pageEnd);
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`Open ${documentName}, ${pages}, case ${caseNumber}`}
      onPress={onPress}
      style={({ pressed }) => [styles.container, pressed && styles.pressed]}
    >
      <Ionicons name="document-text-outline" size={19} color={colors.primary} />
      <View style={styles.text}>
        <Text style={styles.path} numberOfLines={2}>{caseNumber} → {documentName}</Text>
        <Text style={styles.page}>{pages}</Text>
      </View>
      <Ionicons name="open-outline" size={18} color={colors.primary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.md, backgroundColor: colors.primarySoft },
  pressed: { opacity: 0.75 },
  text: { flex: 1 },
  path: { ...typography.caption, fontWeight: '600', color: colors.text },
  page: { ...typography.caption, color: colors.primary },
});
