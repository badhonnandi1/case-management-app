import type { NavigatorScreenParams } from '@react-navigation/native';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type {
  NativeStackScreenProps,
} from '@react-navigation/native-stack';
import type { CompositeScreenProps } from '@react-navigation/native';

export type RootTabParamList = {
  Home: undefined;
  Cases: undefined;
  Calendar: undefined;
  AI: undefined;
  Settings: undefined;
};

export type RootStackParamList = {
  MainTabs: NavigatorScreenParams<RootTabParamList> | undefined;
  AddCase: undefined;
  CaseDetails: { caseId: string };
  EditCase: { caseId: string };
  AddHearingUpdate: { caseId: string };
  DocumentDetails: { documentId: string };
  ImagePreview: { documentId: string };
  CauseListGenerator: { selectedDate: string };
  BackupRestore: undefined;
  Storage: undefined;
  CourtSetup: undefined;
  CaseTasks: { caseId: string };
};

export type HomeScreenProps = CompositeScreenProps<
  BottomTabScreenProps<RootTabParamList, 'Home'>,
  NativeStackScreenProps<RootStackParamList, 'MainTabs'>
>;

export type CasesScreenProps = CompositeScreenProps<
  BottomTabScreenProps<RootTabParamList, 'Cases'>,
  NativeStackScreenProps<RootStackParamList, 'MainTabs'>
>;

export type CalendarScreenProps = CompositeScreenProps<
  BottomTabScreenProps<RootTabParamList, 'Calendar'>,
  NativeStackScreenProps<RootStackParamList, 'MainTabs'>
>;

export type AiAssistantScreenProps = CompositeScreenProps<
  BottomTabScreenProps<RootTabParamList, 'AI'>,
  NativeStackScreenProps<RootStackParamList, 'MainTabs'>
>;

export type AddCaseScreenProps = NativeStackScreenProps<RootStackParamList, 'AddCase'>;
export type CaseDetailsScreenProps = NativeStackScreenProps<
  RootStackParamList,
  'CaseDetails'
>;
export type EditCaseScreenProps = NativeStackScreenProps<RootStackParamList, 'EditCase'>;
export type AddHearingUpdateScreenProps = NativeStackScreenProps<
  RootStackParamList,
  'AddHearingUpdate'
>;
export type DocumentDetailsScreenProps = NativeStackScreenProps<
  RootStackParamList,
  'DocumentDetails'
>;
export type ImagePreviewScreenProps = NativeStackScreenProps<
  RootStackParamList,
  'ImagePreview'
>;
export type CauseListGeneratorScreenProps = NativeStackScreenProps<
  RootStackParamList,
  'CauseListGenerator'
>;

export type BackupRestoreScreenProps = NativeStackScreenProps<
  RootStackParamList,
  'BackupRestore'
>;
export type StorageScreenProps = NativeStackScreenProps<RootStackParamList, 'Storage'>;
export type CourtSetupScreenProps = NativeStackScreenProps<RootStackParamList, 'CourtSetup'>;
export type CaseTasksScreenProps = NativeStackScreenProps<RootStackParamList, 'CaseTasks'>;

export type SettingsScreenProps = CompositeScreenProps<
  BottomTabScreenProps<RootTabParamList, 'Settings'>,
  NativeStackScreenProps<RootStackParamList, 'MainTabs'>
>;
