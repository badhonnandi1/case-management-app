import Ionicons from '@expo/vector-icons/Ionicons';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { ComponentProps } from 'react';
import { lazy, Suspense } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { AddCaseScreen } from '../screens/AddCaseScreen';
import { AddHearingUpdateScreen } from '../screens/AddHearingUpdateScreen';
import { BackupRestoreScreen } from '../screens/BackupRestoreScreen';
import { CalendarScreen } from '../screens/CalendarScreen';
import { CauseListGeneratorScreen } from '../screens/CauseListGeneratorScreen';
import { CaseDetailsScreen } from '../screens/CaseDetailsScreen';
import { CasesScreen } from '../screens/CasesScreen';
import { EditCaseScreen } from '../screens/EditCaseScreen';
import { DocumentDetailsScreen } from '../screens/DocumentDetailsScreen';
import { HomeScreen } from '../screens/HomeScreen';
import { ImagePreviewScreen } from '../screens/ImagePreviewScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { StorageScreen } from '../screens/StorageScreen';
import { colors } from '../theme/colors';
import { typography } from '../theme/typography';
import type { RootStackParamList, RootTabParamList } from './types';

const Tab = createBottomTabNavigator<RootTabParamList>();
const Stack = createNativeStackNavigator<RootStackParamList>();
const AiAssistantScreen = lazy(async () => {
  const module = await import('../screens/AiAssistantScreen');
  return { default: module.AiAssistantScreen };
});

type IconName = ComponentProps<typeof Ionicons>['name'];

const tabIcons: Record<keyof RootTabParamList, { active: IconName; inactive: IconName }> = {
  Home: { active: 'home', inactive: 'home-outline' },
  Cases: { active: 'briefcase', inactive: 'briefcase-outline' },
  Calendar: { active: 'calendar', inactive: 'calendar-outline' },
  AI: { active: 'sparkles', inactive: 'sparkles-outline' },
  Settings: { active: 'settings', inactive: 'settings-outline' },
};

export function AppNavigator() {
  return (
    <Suspense fallback={<View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background }}><ActivityIndicator size="large" color={colors.primary} /></View>}>
    <NavigationContainer>
      <Stack.Navigator
        initialRouteName="MainTabs"
        screenOptions={{
          animation: 'slide_from_right',
          contentStyle: { backgroundColor: colors.background },
          headerBackButtonDisplayMode: 'minimal',
          headerShadowVisible: false,
          headerStyle: { backgroundColor: colors.surface },
          headerTintColor: colors.primary,
          headerTitleStyle: {
            color: colors.text,
            fontSize: 17,
            fontWeight: '600',
          },
        }}
      >
        <Stack.Screen name="MainTabs" component={MainTabs} options={{ headerShown: false }} />
        <Stack.Screen name="AddCase" component={AddCaseScreen} options={{ title: 'Add Case' }} />
        <Stack.Screen
          name="CaseDetails"
          component={CaseDetailsScreen}
          options={{ title: 'Case Details' }}
        />
        <Stack.Screen
          name="DocumentDetails"
          component={DocumentDetailsScreen}
          options={{ title: 'Document Details' }}
        />
        <Stack.Screen
          name="ImagePreview"
          component={ImagePreviewScreen}
          options={{ title: 'Image Preview', headerStyle: { backgroundColor: '#111827' }, headerTintColor: '#FFFFFF' }}
        />
        <Stack.Screen
          name="CauseListGenerator"
          component={CauseListGeneratorScreen}
          options={{ title: 'Daily Cause List' }}
        />
        <Stack.Screen name="EditCase" component={EditCaseScreen} options={{ title: 'Edit Case' }} />
        <Stack.Screen
          name="AddHearingUpdate"
          component={AddHearingUpdateScreen}
          options={{ title: 'Add Hearing Update' }}
        />
        <Stack.Screen
          name="BackupRestore"
          component={BackupRestoreScreen}
          options={{ title: 'Backup & Restore' }}
        />
        <Stack.Screen name="Storage" component={StorageScreen} options={{ title: 'Storage' }} />
      </Stack.Navigator>
    </NavigationContainer>
    </Suspense>
  );
}

function MainTabs() {
  return (
    <Tab.Navigator
      initialRouteName="Home"
      screenOptions={({ route }) => ({
          headerShown: false,
          lazy: true,
          tabBarActiveTintColor: colors.primary,
          tabBarInactiveTintColor: colors.textMuted,
          tabBarHideOnKeyboard: true,
          tabBarLabelStyle: {
            ...typography.caption,
            fontSize: 12,
            fontWeight: '600',
          },
          tabBarStyle: {
            height: 66,
            paddingTop: 6,
            paddingBottom: 8,
            borderTopColor: colors.border,
            backgroundColor: colors.surface,
            elevation: 8,
          },
          tabBarIcon: ({ color, focused, size }) => {
            const icons = tabIcons[route.name];
            return (
              <Ionicons
                name={focused ? icons.active : icons.inactive}
                size={size}
                color={color}
              />
            );
          },
      })}
    >
      <Tab.Screen name="Home" component={HomeScreen} />
      <Tab.Screen name="Cases" component={CasesScreen} />
      <Tab.Screen name="Calendar" component={CalendarScreen} />
      <Tab.Screen name="AI" component={AiAssistantScreen} />
      <Tab.Screen name="Settings" component={SettingsScreen} />
    </Tab.Navigator>
  );
}
