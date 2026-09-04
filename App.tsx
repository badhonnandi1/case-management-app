import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';

import { PrimaryButton } from './src/components/PrimaryButton';
import { initializeDatabase } from './src/database/database';
import { AppNavigator } from './src/navigation/AppNavigator';
import {
  initializeNotificationChannel,
  syncScheduledReminders,
} from './src/services/notificationService';
import { colors } from './src/theme/colors';
import { spacing } from './src/theme/spacing';
import { typography } from './src/theme/typography';

type InitializationState = 'loading' | 'ready' | 'error';

export default function App() {
  const [initializationState, setInitializationState] =
    useState<InitializationState>('loading');

  const prepareApp = useCallback(async () => {
    setInitializationState('loading');

    try {
      await initializeDatabase();
      try {
        await initializeNotificationChannel();
      } catch (notificationError) {
        console.error('Unable to initialize the hearing reminder channel.', notificationError);
      }
      setInitializationState('ready');
      void syncScheduledReminders().catch((error: unknown) => {
        console.error('Unable to synchronize local hearing reminders.', error);
      });
    } catch (error) {
      console.error('Unable to initialize the local database.', error);
      setInitializationState('error');
    }
  }, []);

  useEffect(() => {
    void prepareApp();
  }, [prepareApp]);

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      {initializationState === 'ready' ? (
        <AppNavigator />
      ) : (
        <View style={styles.stateContainer}>
          {initializationState === 'loading' ? (
            <>
              <ActivityIndicator size="large" color={colors.primary} />
              <Text style={styles.stateTitle}>Preparing your case files</Text>
              <Text style={styles.stateMessage}>
                Setting up secure offline storage on this device.
              </Text>
            </>
          ) : (
            <>
              <Text style={styles.stateTitle}>Local storage is unavailable</Text>
              <Text style={styles.stateMessage}>
                The app could not open its local database. Please try again.
              </Text>
              <PrimaryButton label="Try again" onPress={() => void prepareApp()} />
            </>
          )}
        </View>
      )}
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  stateContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    padding: spacing.xl,
    backgroundColor: colors.background,
  },
  stateTitle: {
    ...typography.heading,
    marginTop: spacing.sm,
    textAlign: 'center',
    color: colors.text,
  },
  stateMessage: {
    ...typography.body,
    maxWidth: 320,
    marginBottom: spacing.sm,
    textAlign: 'center',
    color: colors.textMuted,
  },
});
