import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { CaseDocument } from '../models/CaseDocument';
import type { ImagePreviewScreenProps } from '../navigation/types';
import { getDocumentById } from '../repositories/documentRepository';
import { checkFileExists, shareFile } from '../services/fileService';
import { spacing } from '../theme/spacing';
import { typography } from '../theme/typography';

export function ImagePreviewScreen({ route }: ImagePreviewScreenProps) {
  const [document, setDocument] = useState<CaseDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [sharing, setSharing] = useState(false);
  const { documentId } = route.params;

  useEffect(() => {
    let active = true;
    getDocumentById(documentId)
      .then((loaded) => { if (active) setDocument(loaded); })
      .catch((error: unknown) => console.error('Unable to load image preview.', error))
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [documentId]);

  async function handleShare() {
    if (!document || sharing) return;
    setSharing(true);
    try {
      await shareFile(document.filePath, 'IMAGE');
    } catch (error) {
      console.error('Unable to share preview image.', error);
      Alert.alert('Unable to share', 'The image may be missing or sharing may be unavailable.');
    } finally {
      setSharing(false);
    }
  }

  if (loading) return <SafeAreaView style={styles.screen} edges={['bottom']}><ActivityIndicator size="large" color="#FFFFFF" /></SafeAreaView>;
  if (!document || document.fileType !== 'IMAGE' || !checkFileExists(document.filePath)) {
    return <SafeAreaView style={styles.screen} edges={['bottom']}><View style={styles.missingState}><Ionicons name="image-outline" size={42} color="#CBD5E1" /><Text style={styles.missingTitle}>Image unavailable</Text><Text style={styles.missingMessage}>This image is missing from local storage.</Text></View></SafeAreaView>;
  }

  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <Image source={{ uri: document.filePath }} resizeMode="contain" style={styles.image} accessibilityLabel={document.fileName} />
      <View style={styles.footer}>
        <Text style={styles.fileName} numberOfLines={1}>{document.fileName}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Share image" disabled={sharing} onPress={() => void handleShare()} style={styles.shareButton}>
          {sharing ? <ActivityIndicator color="#FFFFFF" /> : <Ionicons name="share-social-outline" size={22} color="#FFFFFF" />}
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#111827' },
  image: { width: '100%', flex: 1 },
  footer: { width: '100%', minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, backgroundColor: '#0B1220' },
  fileName: { ...typography.body, flex: 1, color: '#FFFFFF' },
  shareButton: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  missingState: { alignItems: 'center', gap: spacing.md, padding: spacing.xl },
  missingTitle: { ...typography.subheading, color: '#FFFFFF' },
  missingMessage: { ...typography.body, textAlign: 'center', color: '#CBD5E1' },
});
