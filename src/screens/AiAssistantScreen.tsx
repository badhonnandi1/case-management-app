import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect } from '@react-navigation/native';
import * as Clipboard from 'expo-clipboard';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppCard } from '../components/AppCard';
import { AppHeader } from '../components/AppHeader';
import { AiChatView } from '../components/ai/AiChatView';
import { AiOnlineConsent } from '../components/ai/AiOnlineConsent';
import { CaseSelector } from '../components/ai/CaseSelector';
import { DocumentSelector } from '../components/ai/DocumentSelector';
import { IndexingProgress } from '../components/ai/IndexingProgress';
import { LocalSearchPreview } from '../components/ai/LocalSearchPreview';
import { EmptyState } from '../components/EmptyState';
import { PrimaryButton } from '../components/PrimaryButton';
import type { AiPublicConfigDto } from '../../shared/aiAnswerContract';
import type { AiSearchResult } from '../models/AiChunk';
import type { PreparedAiConversationEvidence } from '../models/AiConversation';
import type { AiMessageWithCitations } from '../models/AiMessage';
import type { AiThreadSummary } from '../models/AiThread';
import type { AiDocumentChoice, AiPreparationItem } from '../models/AiUi';
import type { Case } from '../models/Case';
import type { AiAssistantScreenProps } from '../navigation/types';
import {
  createAiThread,
  clearAiConversation,
  deleteAiThread,
  getAiThreadById,
  getRecentAiThreads,
  renameAiThread,
  saveAiExchangeWithCitations,
  saveAiMessageWithCitations,
  updateAiThreadScope,
} from '../repositories/aiChatRepository';
import { validateAiCitationTarget } from '../repositories/aiChunkRepository';
import { findAiSourcesByDocuments, removeAllAiIndexes, removeDocumentIndexes } from '../repositories/aiSourceRepository';
import { getAllCases, getCasesByIds } from '../repositories/caseRepository';
import { getDocumentById, getDocumentsByCaseIds } from '../repositories/documentRepository';
import { checkAiAssistantAvailability } from '../services/aiAssistantAvailabilityService';
import { sendOnlineAiAnswer } from '../services/aiAnswerApiService';
import { AiAnswerApiError } from '../services/aiAnswerTransport';
import {
  checkAiBackendAvailability,
  type AiBackendAvailability,
  wakeAiBackendAvailability,
} from '../services/aiBackendAvailabilityService';
import { validateAiBackendUrl } from '../services/aiBackendConfig';
import { prepareAiDocumentsSequentially } from '../services/aiBatchIndexService';
import {
  AiConversationPreparationError,
  prepareAiConversationEvidence,
  restoreAiConversation,
} from '../services/aiConversationService';
import { inspectAiDocumentChoices } from '../services/aiDocumentStatusService';
import { checkFileExists, openPdf } from '../services/fileService';
import { refreshAiPublicConfiguration } from '../services/aiSettingsService';
import {
  hasCurrentAiOnlineConsent,
  recordCurrentAiOnlineConsent,
  resetAiOnlineConsent,
} from '../services/aiOnlineConsentService';
import { colors } from '../theme/colors';
import { radius, spacing } from '../theme/spacing';
import { typography } from '../theme/typography';
import {
  aiAssistantReducer,
  createDefaultThreadTitle,
  formatCitationPages,
  initialAiAssistantState,
} from '../utils/aiUi';
import {
  inferAiQuestionLanguage,
  isCurrentAiRequestSequence,
  isAiRequestActive,
  safeAiRequestError,
  validateAiQuestion,
} from '../utils/aiConversation';
import { formatDisplayDateTime } from '../utils/date';
import { createId } from '../utils/id';

interface RenameTarget { id: string; title: string }

type BackendUiState = AiBackendAvailability | { status: 'unchecked' | 'checking' | 'waking' };

interface PendingChatRequest {
  sequence: number;
  requestId: string;
  question: string;
  mode: 'new' | 'regenerate';
  prepared: PreparedAiConversationEvidence;
  publicConfig: AiPublicConfigDto;
  modelId: string;
  controller: AbortController;
}

export function AiAssistantScreen(_props: AiAssistantScreenProps) {
  const [state, dispatch] = useReducer(aiAssistantReducer, initialAiAssistantState);
  const stateRef = useRef(state);
  stateRef.current = state;
  const [initialized, setInitialized] = useState(false);
  const [homeLoading, setHomeLoading] = useState(true);
  const [recentThreads, setRecentThreads] = useState<AiThreadSummary[]>([]);
  const [allCases, setAllCases] = useState<Case[]>([]);
  const [draftCaseIds, setDraftCaseIds] = useState<string[]>([]);
  const [draftDocumentIds, setDraftDocumentIds] = useState<string[]>([]);
  const [documentCases, setDocumentCases] = useState<Case[]>([]);
  const [documentChoices, setDocumentChoices] = useState<AiDocumentChoice[]>([]);
  const [documentLoading, setDocumentLoading] = useState(false);
  const [documentCheckedCount, setDocumentCheckedCount] = useState(0);
  const [documentTotalCount, setDocumentTotalCount] = useState(0);
  const [documentError, setDocumentError] = useState<string | null>(null);
  const documentCheckController = useRef<AbortController | null>(null);
  const [preparationItems, setPreparationItems] = useState<AiPreparationItem[]>([]);
  const preparationItemsRef = useRef<AiPreparationItem[]>([]);
  const [activePreparationIndex, setActivePreparationIndex] = useState(-1);
  const [preparationRunning, setPreparationRunning] = useState(false);
  const preparationRunningRef = useRef(false);
  const preparationController = useRef<AbortController | null>(null);
  const [renameTarget, setRenameTarget] = useState<RenameTarget | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renameSaving, setRenameSaving] = useState(false);
  const [threadMenuVisible, setThreadMenuVisible] = useState(false);
  const [policyReviewVisible, setPolicyReviewVisible] = useState(false);
  const [conversationEntries, setConversationEntries] = useState<AiMessageWithCitations[]>([]);
  const [conversationCases, setConversationCases] = useState<Case[]>([]);
  const [conversationDocuments, setConversationDocuments] = useState<Awaited<ReturnType<typeof getDocumentsByCaseIds>>>([]);
  const [questionDraft, setQuestionDraft] = useState('');
  const [backendState, setBackendState] = useState<BackendUiState>({ status: 'unchecked' });
  const [activePublicConfig, setActivePublicConfig] = useState<AiPublicConfigDto | null>(null);
  const [freshInsufficientMessageIds, setFreshInsufficientMessageIds] = useState<Set<string>>(() => new Set());
  const [warningsByMessageId, setWarningsByMessageId] = useState<Map<string, readonly string[]>>(() => new Map());
  const requestController = useRef<AbortController | null>(null);
  const backendWakeController = useRef<AbortController | null>(null);
  const persistenceStarted = useRef(false);
  const pendingChatRequest = useRef<PendingChatRequest | null>(null);
  const failedChatRequest = useRef<{ question: string; mode: 'new' | 'regenerate' } | null>(null);
  const requestSequence = useRef(0);
  const selectedCaseKey = state.selectedCaseIds.join('\u001f');

  useEffect(() => {
    preparationRunningRef.current = preparationRunning;
  }, [preparationRunning]);

  const refreshHome = useCallback(async () => {
    const [threads, cases] = await Promise.all([getRecentAiThreads(), getAllCases()]);
    setRecentThreads(threads);
    setAllCases(cases);
  }, []);

  const refreshBackendAvailability = useCallback(async (signal?: AbortSignal, wake = false) => {
    setBackendState({ status: wake ? 'waking' : 'checking' });
    let availability: AiBackendAvailability;
    try {
      availability = wake
        ? await wakeAiBackendAvailability({ signal })
        : await checkAiBackendAvailability(5_000, signal);
    } catch {
      availability = { status: 'backend_unreachable' };
    }
    if (!signal?.aborted) setBackendState(availability);
    return availability;
  }, []);

  const loadConversation = useCallback(async (threadId: string, signal: AbortSignal) => {
    try {
      const restored = await restoreAiConversation(threadId, signal);
      if (signal.aborted || stateRef.current.threadId !== threadId) return;
      setConversationEntries(restored.messages);
      setConversationCases(restored.cases);
      setConversationDocuments(restored.documents);
      setDocumentChoices(restored.choices);
      setDocumentCases(restored.cases);
      setFreshInsufficientMessageIds(new Set());
      setWarningsByMessageId(new Map());
      dispatch({
        type: 'UPDATE_CHAT_SCOPE',
        caseIds: restored.thread.caseIds,
        documentIds: restored.thread.documentIds,
        readySourceCount: restored.readySourceCount,
        changed: restored.scopeChanged,
      });
      dispatch({ type: 'CHAT_RESTORED', readySourceCount: restored.readySourceCount });
      if (restored.readySourceCount === 0) {
        dispatch({
          type: 'SOURCES_INVALIDATED',
          message: 'No current ready source remains. Re-index changed documents or select other sources; saved history remains available.',
        });
      }
    } catch (error) {
      if (signal.aborted) return;
      if (error instanceof AiConversationPreparationError && error.code === 'THREAD_MISSING') {
        Alert.alert('Session unavailable', error.message);
        dispatch({ type: 'GO_HOME' });
        await refreshHome();
        return;
      }
      dispatch({ type: 'FAIL', message: 'The saved conversation could not be restored. Other app features are unaffected.', recoverTo: 'home' });
    }
  }, [refreshHome]);

  useEffect(() => {
    if (state.phase !== 'chat_loading' || !state.threadId) return;
    const controller = new AbortController();
    const config = validateAiBackendUrl(process.env.EXPO_PUBLIC_AI_BACKEND_URL, !__DEV__);
    if (!config.configured) {
      setBackendState({ status: config.reason === 'not_configured' ? 'not_configured' : 'invalid_configuration' });
    } else {
      setBackendState({ status: 'unchecked' });
    }
    void loadConversation(state.threadId, controller.signal);
    return () => controller.abort();
  }, [loadConversation, state.phase, state.threadId]);

  const initializeAiTab = useCallback(async () => {
    setHomeLoading(true);
    try {
      const availability = await checkAiAssistantAvailability();
      if (!availability.available) {
        dispatch({ type: 'FAIL', message: availability.message ?? 'Local AI tools are unavailable.', recoverTo: 'home' });
        setInitialized(true);
        return;
      }
      await refreshHome();
      const current = stateRef.current;
      if (current.phase === 'error') dispatch({ type: 'RECOVER' });
      if (isAiRequestActive(current.phase)) {
        setInitialized(true);
        return;
      }
      if (current.phase !== 'home' && current.selectedCaseIds.length > 0) {
        const validCases = await getCasesByIds(current.selectedCaseIds);
        const documents = await getDocumentsByCaseIds(validCases.map((item) => item.id));
        const documentSet = new Set(documents.map((item) => item.id));
        const validDocumentIds = current.selectedDocumentIds.filter((id) => documentSet.has(id));
        if (current.threadId) {
          const sources = await findAiSourcesByDocuments(validDocumentIds);
          dispatch({
            type: 'OPEN_THREAD',
            threadId: current.threadId,
            title: current.threadTitle ?? 'Prepared Sources',
            caseIds: validCases.map((item) => item.id),
            documentIds: validDocumentIds,
            ready: sources.some((source) => source.extractionStatus === 'ready'),
          });
        } else if (validCases.length !== current.selectedCaseIds.length) {
          setDraftCaseIds(validCases.map((item) => item.id));
          dispatch({ type: 'SET_CASES', caseIds: validCases.map((item) => item.id) });
        } else if (validDocumentIds.length !== current.selectedDocumentIds.length) {
          setDraftDocumentIds(validDocumentIds);
          dispatch({ type: 'SET_DOCUMENTS', documentIds: validDocumentIds });
        }
      }
      setInitialized(true);
    } catch {
      dispatch({ type: 'FAIL', message: 'The local AI workspace could not be opened. Other app features are unaffected.', recoverTo: 'home' });
      setInitialized(true);
    } finally {
      setHomeLoading(false);
    }
  }, [refreshHome]);

  useFocusEffect(useCallback(() => {
    void initializeAiTab();
    const backSubscription = BackHandler.addEventListener('hardwareBackPress', () => {
      const current = stateRef.current;
      if (current.phase === 'home' || current.phase === 'error') return false;
      if (current.phase === 'chat_saving' || persistenceStarted.current) {
        Alert.alert('Saving validated answer', 'The local transaction is finishing and cannot be interrupted safely.');
        return true;
      }
      if (isAiRequestActive(current.phase)) {
        Alert.alert('Cancel this request?', 'Your question will remain in the composer and no incomplete answer will be saved.', [
          { text: 'Keep Waiting', style: 'cancel' },
          { text: 'Cancel Request', style: 'destructive', onPress: cancelChatRequest },
        ]);
        return true;
      }
      if (current.phase === 'preparing' && preparationRunningRef.current) {
        Alert.alert('Cancel preparation?', 'Leaving now will cancel the active document safely. Completed indexes will remain available.', [
          { text: 'Keep Preparing', style: 'cancel' },
          {
            text: 'Cancel and Leave',
            style: 'destructive',
            onPress: () => {
              preparationController.current?.abort();
              dispatch({ type: 'EDIT_DOCUMENTS' });
            },
          },
        ]);
        return true;
      }
      if (current.phase === 'search') dispatch({ type: 'CLOSE_SEARCH' });
      else if (current.phase === 'document_selection') dispatch({ type: 'CHANGE_SOURCES' });
      else if (current.phase === 'preparing') dispatch({ type: 'EDIT_DOCUMENTS' });
      else dispatch({ type: 'GO_HOME' });
      return true;
    });
    return () => {
      backSubscription.remove();
      documentCheckController.current?.abort();
      backendWakeController.current?.abort();
      if (preparationRunningRef.current) preparationController.current?.abort();
    };
  }, [initializeAiTab]));

  const loadDocumentChoices = useCallback(async (caseIds: readonly string[]) => {
    documentCheckController.current?.abort();
    const controller = new AbortController();
    documentCheckController.current = controller;
    setDocumentLoading(true);
    setDocumentError(null);
    setDocumentCheckedCount(0);
    setDocumentTotalCount(0);
    setDocumentChoices([]);
    try {
      const [cases, documents] = await Promise.all([
        getCasesByIds(caseIds),
        getDocumentsByCaseIds(caseIds),
      ]);
      if (controller.signal.aborted) return;
      setDocumentCases(cases);
      setDocumentTotalCount(documents.length);
      const inspected = await inspectAiDocumentChoices(cases, documents, {
        signal: controller.signal,
        onDocument: (choice, completed) => {
          if (controller.signal.aborted) return;
          setDocumentChoices((current) => [...current, choice]);
          setDocumentCheckedCount(completed);
        },
      });
      if (controller.signal.aborted) return;
      setDocumentChoices(inspected);
      const documentSet = new Set(inspected.map((choice) => choice.document.id));
      const validSelectedIds = stateRef.current.selectedDocumentIds.filter((id) => documentSet.has(id));
      setDraftDocumentIds(validSelectedIds);
      if (validSelectedIds.length !== stateRef.current.selectedDocumentIds.length) {
        dispatch({ type: 'SET_DOCUMENTS', documentIds: validSelectedIds });
      }
    } catch {
      if (!controller.signal.aborted) setDocumentError('Document status could not be checked from local storage.');
    } finally {
      if (!controller.signal.aborted) setDocumentLoading(false);
    }
  }, []);

  useEffect(() => {
    if ((state.phase === 'document_selection' || state.phase === 'ready') && state.selectedCaseIds.length > 0) {
      void loadDocumentChoices(state.selectedCaseIds);
    }
    return () => documentCheckController.current?.abort();
  }, [loadDocumentChoices, selectedCaseKey, state.phase]);

  async function resumeThread(threadId: string) {
    setHomeLoading(true);
    try {
      const thread = await getAiThreadById(threadId);
      if (!thread) {
        Alert.alert('Session unavailable', 'This prepared session may have been deleted.');
        await refreshHome();
        return;
      }
      const cases = await getCasesByIds(thread.caseIds);
      const documents = await getDocumentsByCaseIds(cases.map((item) => item.id));
      const validDocumentSet = new Set(documents.map((item) => item.id));
      const validDocumentIds = thread.documentIds.filter((id) => validDocumentSet.has(id));
      const sources = await findAiSourcesByDocuments(validDocumentIds);
      const validCaseIds = cases.map((item) => item.id);
      if (validCaseIds.length !== thread.caseIds.length || validDocumentIds.length !== thread.documentIds.length) {
        await updateAiThreadScope(thread.id, validCaseIds, validDocumentIds);
      }
      setDraftCaseIds(validCaseIds);
      setDraftDocumentIds(validDocumentIds);
      dispatch({
        type: 'OPEN_THREAD',
        threadId: thread.id,
        title: thread.title,
        caseIds: validCaseIds,
        documentIds: validDocumentIds,
        ready: sources.some((source) => source.extractionStatus === 'ready'),
      });
    } catch {
      Alert.alert('Unable to resume session', 'The saved local scope could not be loaded.');
    } finally {
      setHomeLoading(false);
    }
  }

  function startNewSelection() {
    setDraftCaseIds([]);
    setDraftDocumentIds([]);
    setDocumentChoices([]);
    dispatch({ type: 'START_SELECTION' });
  }

  function continueFromCases() {
    if (draftCaseIds.length === 0) return;
    dispatch({ type: 'SET_CASES', caseIds: draftCaseIds });
  }

  function backToCaseSelection() {
    setDraftCaseIds([...state.selectedCaseIds]);
    dispatch({ type: 'CHANGE_SOURCES' });
  }

  function startPreparation() {
    const selectedDocumentSet = new Set(draftDocumentIds);
    const selected = documentChoices.filter((choice) => selectedDocumentSet.has(choice.document.id) && choice.processable);
    if (selected.length === 0) {
      Alert.alert('No usable documents', 'Select at least one available PDF or OCR-required image.');
      return;
    }
    dispatch({ type: 'SET_DOCUMENTS', documentIds: draftDocumentIds });
    dispatch({ type: 'START_PREPARING' });
    void runPreparation(selected, []);
  }

  async function runPreparation(choices: readonly AiDocumentChoice[], baseItems: readonly AiPreparationItem[]) {
    if (preparationRunningRef.current || choices.length === 0) return;
    const controller = new AbortController();
    preparationController.current = controller;
    preparationRunningRef.current = true;
    setPreparationRunning(true);
    const base = [...baseItems];
    if (base.length === 0) {
      preparationItemsRef.current = [];
      setPreparationItems([]);
    }
    try {
      const result = await prepareAiDocumentsSequentially(choices, {
        signal: controller.signal,
        onChange: (updates, activeIndex) => {
          const merged = mergePreparationItems(base, updates);
          preparationItemsRef.current = merged;
          setPreparationItems(merged);
          const activeDocumentId = updates[activeIndex]?.documentId;
          setActivePreparationIndex(activeDocumentId ? merged.findIndex((item) => item.documentId === activeDocumentId) : -1);
        },
      });
      const merged = mergePreparationItems(base, result);
      preparationItemsRef.current = merged;
      setPreparationItems(merged);
    } finally {
      preparationRunningRef.current = false;
      setPreparationRunning(false);
      setActivePreparationIndex(-1);
      preparationController.current = null;
    }
  }

  function retryPreparation(documentIds: string[]) {
    const choices = documentChoices.filter((choice) => documentIds.includes(choice.document.id));
    void runPreparation(choices, preparationItemsRef.current);
  }

  async function finishPreparation() {
    try {
      const cases = await getCasesByIds(stateRef.current.selectedCaseIds);
      const documents = await getDocumentsByCaseIds(cases.map((item) => item.id));
      const documentSet = new Set(documents.map((item) => item.id));
      const validDocumentIds = stateRef.current.selectedDocumentIds.filter((id) => documentSet.has(id));
      const sources = await findAiSourcesByDocuments(validDocumentIds);
      if (!sources.some((source) => source.extractionStatus === 'ready')) {
        Alert.alert('No ready sources', 'At least one selected document must have a complete local index.');
        return;
      }
      let thread = stateRef.current.threadId ? await updateAiThreadScope(
        stateRef.current.threadId,
        cases.map((item) => item.id),
        validDocumentIds,
      ) : null;
      if (!thread) {
        thread = await createAiThread({
          title: createDefaultThreadTitle(cases),
          caseIds: cases.map((item) => item.id),
          documentIds: validDocumentIds,
        });
      }
      dispatch({ type: 'SET_DOCUMENTS', documentIds: validDocumentIds });
      dispatch({ type: 'SOURCES_READY', threadId: thread.id, title: thread.title });
      await refreshHome();
    } catch {
      dispatch({ type: 'FAIL', message: 'The prepared session could not be saved. Please review the selected sources and retry.', recoverTo: 'document_selection' });
    }
  }

  function changeSources() {
    setDraftCaseIds([...state.selectedCaseIds]);
    setDraftDocumentIds([...state.selectedDocumentIds]);
    dispatch({ type: 'CHANGE_SOURCES' });
  }

  function reindexChangedDocuments() {
    const selectedDocumentSet = new Set(state.selectedDocumentIds);
    const selected = documentChoices.filter((choice) => selectedDocumentSet.has(choice.document.id));
    const changed = selected.filter((choice) =>
      choice.status === 'changed' || choice.status === 'failed' || choice.status === 'interrupted' || choice.status === 'not_prepared',
    );
    if (changed.length === 0) {
      Alert.alert('Sources are current', 'No selected document needs re-indexing.');
      return;
    }
    const baseline = selected
      .filter((choice) => choice.status === 'ready')
      .map((choice): AiPreparationItem => ({
        documentId: choice.document.id,
        documentName: choice.document.fileName,
        status: 'reused',
        stage: 'skipped',
        completedPages: 0,
        pageCount: choice.source?.pageCount ?? null,
        message: null,
      }));
    dispatch({ type: 'START_PREPARING' });
    void runPreparation(changed, baseline);
  }

  function showThreadMenu() {
    setThreadMenuVisible(true);
  }

  function confirmRemoveSelectedIndexes() {
    Alert.alert('Remove Selected AI Indexes?', 'Derived search text for the selected documents will be removed. Original cases, records, PDFs, and images will be preserved.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove Indexes', style: 'destructive', onPress: () => void removeSelectedIndexes() },
    ]);
  }

  async function removeSelectedIndexes() {
    try {
      await removeDocumentIndexes(stateRef.current.selectedDocumentIds);
      Alert.alert('Indexes removed', 'Original cases and documents were not changed.');
      dispatch({ type: 'EDIT_DOCUMENTS' });
    } catch {
      Alert.alert('Unable to remove indexes', 'The local derived data could not be removed.');
    }
  }

  function confirmRemoveAllIndexes() {
    Alert.alert('Delete All Local AI Indexes?', 'All derived search text will be deleted. Original case data and files will be preserved.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete Indexes', style: 'destructive', onPress: () => void removeEveryIndex() },
    ]);
  }

  async function removeEveryIndex() {
    try {
      await removeAllAiIndexes();
      Alert.alert('Local AI indexes deleted', 'No original case record or document was removed.');
      dispatch({ type: 'EDIT_DOCUMENTS' });
      await refreshHome();
    } catch {
      Alert.alert('Unable to delete indexes', 'The derived local data could not be deleted.');
    }
  }

  function confirmDeleteThread(threadId: string) {
    Alert.alert('Delete Prepared Session?', 'The session will be deleted, but reusable document indexes and original files will remain.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete Session', style: 'destructive', onPress: () => void handleDeleteThread(threadId) },
    ]);
  }

  async function handleDeleteThread(threadId: string) {
    try {
      await deleteAiThread(threadId);
      await refreshHome();
      if (stateRef.current.threadId === threadId) dispatch({ type: 'GO_HOME' });
    } catch {
      Alert.alert('Unable to delete session', 'The local prepared session could not be deleted.');
    }
  }

  function openRename(target: RenameTarget) {
    setRenameTarget(target);
    setRenameValue(target.title);
  }

  async function saveRename() {
    if (!renameTarget || !renameValue.trim() || renameSaving) return;
    setRenameSaving(true);
    try {
      const renamed = await renameAiThread(renameTarget.id, renameValue);
      if (!renamed) throw new Error('Session missing');
      if (stateRef.current.threadId === renamed.id) dispatch({ type: 'RENAME_THREAD', title: renamed.title });
      setRenameTarget(null);
      await refreshHome();
    } catch {
      Alert.alert('Unable to rename session', 'Enter a valid title and try again.');
    } finally {
      setRenameSaving(false);
    }
  }

  async function openCitation(result: AiSearchResult) {
    try {
      const document = await getDocumentById(result.documentId);
      if (!document || !checkFileExists(document.filePath)) {
        Alert.alert('Source file missing', 'The original local file is no longer available. Return to source selection to update this session.', [
          { text: 'Close', style: 'cancel' },
          { text: 'Change Sources', onPress: changeSources },
        ]);
        return;
      }
      const pages = formatCitationPages(result.pageStart, result.pageEnd);
      Alert.alert(
        `${document.fileName} · ${pages}`,
        'The installed PDF viewer does not support a reliable page jump. Open the document and navigate to the cited page.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Open PDF', onPress: () => void openPdf(document.filePath).catch(() => Alert.alert('Unable to open PDF', 'No compatible PDF viewer may be installed.')) },
        ],
      );
    } catch {
      Alert.alert('Unable to open source', 'The local document could not be opened.');
    }
  }

  async function submitChatQuestion(questionInput: string, mode: 'new' | 'regenerate' = 'new') {
    const validation = validateAiQuestion(questionInput);
    const current = stateRef.current;
    if (!validation.valid || requestController.current || !current.threadId
      || current.readySourceCount === 0 || !backendCanAttempt(backendState)) return;

    const controller = new AbortController();
    const sequence = requestSequence.current + 1;
    requestSequence.current = sequence;
    requestController.current = controller;
    persistenceStarted.current = false;
    failedChatRequest.current = { question: validation.question, mode };
    dispatch({ type: 'START_CHAT_REQUEST' });

    try {
      const prepared = await prepareAiConversationEvidence({
        threadId: current.threadId,
        question: validation.question,
        signal: controller.signal,
      });
      if (!isCurrentRequest(sequence, controller)) return;
      dispatch({ type: 'LOCAL_EVIDENCE_FOUND' });
      dispatch({
        type: 'UPDATE_CHAT_SCOPE',
        caseIds: prepared.caseIds,
        documentIds: prepared.documentIds,
        readySourceCount: prepared.readyDocumentIds.length,
        changed: prepared.scopeChanged,
      });
      if (prepared.scopeChanged) {
        const restored = await restoreAiConversation(prepared.thread.id, controller.signal);
        if (!isCurrentRequest(sequence, controller)) return;
        setConversationCases(restored.cases);
        setConversationDocuments(restored.documents);
        setDocumentChoices(restored.choices);
        setDocumentCases(restored.cases);
      }

      const availability = await refreshBackendAvailability(controller.signal);
      if (!isCurrentRequest(sequence, controller)) return;
      assertBackendAvailable(availability);
      const publicConfiguration = await refreshAiPublicConfiguration(controller.signal);
      if (!isCurrentRequest(sequence, controller)) return;
      if (!publicConfiguration.config.features.onlineAnswers) {
        throw new AiAnswerApiError('PROVIDER_NOT_CONFIGURED', 'Online answers are disabled by the backend administrator.');
      }
      setActivePublicConfig(publicConfiguration.config);
      if (publicConfiguration.selectionChanged) {
        Alert.alert('AI model updated', `The previously selected model is no longer available. ${publicConfiguration.selectedModelId} will be used.`);
      }
      const pending: PendingChatRequest = {
        sequence,
        requestId: createId(),
        question: validation.question,
        mode,
        prepared,
        publicConfig: publicConfiguration.config,
        modelId: publicConfiguration.selectedModelId,
        controller,
      };
      pendingChatRequest.current = pending;
      const hasConsent = await hasCurrentAiOnlineConsent(publicConfiguration.config.privacy.consentVersion);
      if (!isCurrentRequest(sequence, controller)) return;
      dispatch({ type: 'EVIDENCE_READY', needsConsent: !hasConsent });
      if (hasConsent) await transmitPendingChatRequest(pending);
    } catch (error) {
      handleChatRequestFailure(error, sequence, controller);
    }
  }

  async function acceptOnlineConsent() {
    const pending = pendingChatRequest.current;
    if (!pending || !isCurrentRequest(pending.sequence, pending.controller)) return;
    try {
      await recordCurrentAiOnlineConsent(pending.publicConfig.privacy.consentVersion);
      if (!isCurrentRequest(pending.sequence, pending.controller)) return;
      dispatch({ type: 'CONSENT_GRANTED' });
      await transmitPendingChatRequest(pending);
    } catch (error) {
      handleChatRequestFailure(error, pending.sequence, pending.controller);
    }
  }

  async function transmitPendingChatRequest(pending: PendingChatRequest) {
    if (!isCurrentRequest(pending.sequence, pending.controller)) return;
    dispatch({ type: 'REQUEST_SENT' });
    const response = await sendOnlineAiAnswer({
      requestId: pending.requestId,
      threadId: pending.prepared.thread.id,
      question: pending.question,
      selectedCaseIds: pending.prepared.caseIds,
      selectedDocumentIds: pending.prepared.readyDocumentIds,
      retrievalResults: pending.prepared.evidence,
      language: inferAiQuestionLanguage(pending.question),
      modelId: pending.modelId,
      consentVersion: pending.publicConfig.privacy.consentVersion,
      consentGranted: true,
      signal: pending.controller.signal,
    });
    if (!isCurrentRequest(pending.sequence, pending.controller)) return;
    dispatch({ type: 'RESPONSE_RECEIVED' });

    const citations = response.citations.map((citation) => ({
      chunkId: citation.chunkId,
      documentId: citation.documentId,
      pageStart: citation.pageStart,
      pageEnd: citation.pageEnd,
      citationNumber: citation.citationNumber,
    }));
    if (!response.insufficientEvidence && citations.length === 0) {
      throw new AiAnswerApiError('INVALID_PROVIDER_RESPONSE', 'The answer has no validated citations.');
    }
    dispatch({ type: 'VALIDATION_PASSED' });
    if (!isCurrentRequest(pending.sequence, pending.controller)) return;
    persistenceStarted.current = true;

    const assistantInput = {
      threadId: pending.prepared.thread.id,
      role: 'assistant' as const,
      content: response.answer,
      modelName: response.usage.modelName,
      inputTokens: response.usage.inputTokens,
      outputTokens: response.usage.outputTokens,
      estimatedCost: null,
    };
    let savedEntries: AiMessageWithCitations[];
    if (pending.mode === 'new') {
      const saved = await saveAiExchangeWithCitations({
        user: {
          threadId: pending.prepared.thread.id,
          role: 'user',
          content: pending.question,
          modelName: null,
          inputTokens: null,
          outputTokens: null,
          estimatedCost: null,
        },
        assistant: assistantInput,
        citations,
      });
      savedEntries = [
        { message: saved.user, citations: [] },
        { message: saved.assistant, citations: saved.citations },
      ];
    } else {
      const saved = await saveAiMessageWithCitations(assistantInput, citations);
      savedEntries = [{ message: saved.message, citations: saved.citations }];
    }
    if (!isCurrentRequest(pending.sequence, pending.controller)) return;
    const assistant = savedEntries.at(-1)?.message;
    setConversationEntries((entries) => [...entries, ...savedEntries]);
    if (assistant && response.insufficientEvidence) {
      setFreshInsufficientMessageIds((ids) => new Set(ids).add(assistant.id));
    }
    if (assistant && response.warnings.length > 0) {
      setWarningsByMessageId((currentWarnings) => {
        const next = new Map(currentWarnings);
        next.set(assistant.id, response.warnings);
        return next;
      });
    }
    if (pending.mode === 'new' && questionDraft.trim() === pending.question) setQuestionDraft('');
    failedChatRequest.current = null;
    pendingChatRequest.current = null;
    requestController.current = null;
    persistenceStarted.current = false;
    dispatch({ type: 'EXCHANGE_SAVED' });
    await refreshHome();
  }

  function handleChatRequestFailure(error: unknown, sequence: number, controller: AbortController) {
    if (requestSequence.current !== sequence) return;
    pendingChatRequest.current = null;
    requestController.current = null;
    persistenceStarted.current = false;
    if (controller.signal.aborted
      || (error instanceof AiConversationPreparationError && error.code === 'CANCELLED')
      || (error instanceof AiAnswerApiError && error.code === 'REQUEST_CANCELLED')) {
      dispatch({ type: 'REQUEST_CANCELLED' });
      return;
    }
    if (error instanceof AiConversationPreparationError) {
      if (error.code === 'NO_READY_SOURCES' || error.code === 'EMPTY_SCOPE' || error.code === 'THREAD_MISSING') {
        dispatch({ type: 'SOURCES_INVALIDATED', message: error.message });
      } else {
        dispatch({ type: 'REQUEST_FAILED', message: error.message });
      }
      return;
    }
    if (error instanceof AiAnswerApiError) {
      dispatch({ type: 'REQUEST_FAILED', message: safeAiRequestError(error.code, error.retryAfterSeconds) });
      return;
    }
    const text = error instanceof Error ? error.message.toLowerCase() : '';
    dispatch({
      type: 'REQUEST_FAILED',
      message: text.includes('fts') || text.includes('no such table')
        ? 'Local full-text search is unavailable. No online request was made.'
        : 'The request could not be completed or saved. No incomplete answer was added to this conversation.',
    });
  }

  function cancelChatRequest() {
    if (stateRef.current.phase === 'chat_saving' || persistenceStarted.current) {
      Alert.alert('Saving validated answer', 'The local transaction is finishing and cannot be interrupted safely.');
      return;
    }
    const controller = requestController.current;
    if (!controller) return;
    requestSequence.current += 1;
    controller.abort();
    requestController.current = null;
    pendingChatRequest.current = null;
    dispatch({ type: 'REQUEST_CANCELLED' });
  }

  function cancelOnlineConsent() {
    cancelChatRequest();
  }

  function retryChatRequest() {
    const failed = failedChatRequest.current;
    if (failed) void submitChatQuestion(failed.question, failed.mode);
  }

  async function wakeBackendManually() {
    backendWakeController.current?.abort();
    const controller = new AbortController();
    backendWakeController.current = controller;
    try {
      await refreshBackendAvailability(controller.signal, true);
    } finally {
      if (backendWakeController.current === controller) backendWakeController.current = null;
    }
  }

  function regenerateAnswer(assistantMessageId: string) {
    if (requestController.current) return;
    const answerIndex = conversationEntries.findIndex((entry) => entry.message.id === assistantMessageId);
    if (answerIndex < 0) return;
    for (let index = answerIndex - 1; index >= 0; index -= 1) {
      const entry = conversationEntries[index];
      if (entry?.message.role === 'user') {
        void submitChatQuestion(entry.message.content, 'regenerate');
        return;
      }
    }
    Alert.alert('Question unavailable', 'The original question for this answer is no longer available.');
  }

  async function copyAnswer(content: string) {
    await Clipboard.setStringAsync(content);
    Alert.alert('Copied', 'The answer text was copied. Citations were not copied automatically.');
  }

  async function openSavedCitation(entry: AiMessageWithCitations, citationIndex: number) {
    const citation = entry.citations[citationIndex];
    if (!citation) return;
    try {
      const [document, validChunk] = await Promise.all([
        getDocumentById(citation.documentId),
        validateAiCitationTarget(citation),
      ]);
      if (!document) {
        Alert.alert('Citation unavailable', 'The cited document record was deleted. This saved answer has not been redirected to another source.');
        return;
      }
      if (!checkFileExists(document.filePath)) {
        Alert.alert('Source file missing', `The local file for ${formatCitationPages(citation.pageStart, citation.pageEnd)} is missing.`);
        return;
      }
      const citationCases = await getCasesByIds([document.caseId]);
      const inspected = citationCases.length > 0
        ? await inspectAiDocumentChoices(citationCases, [document])
        : [];
      if (!validChunk || inspected[0]?.status !== 'ready') {
        Alert.alert('Citation may be stale', 'The original indexed chunk no longer matches this citation. Re-index the document and verify the saved answer against the original file.', [
          { text: 'Close', style: 'cancel' },
          { text: 'Review Sources', onPress: changeSources },
        ]);
        return;
      }
      const pages = formatCitationPages(citation.pageStart, citation.pageEnd);
      Alert.alert(`${document.fileName} · ${pages}`, 'The installed PDF viewer does not support a reliable page jump. Open the local document and navigate to the cited page.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Open PDF', onPress: () => void openPdf(document.filePath).catch(() => Alert.alert('Unable to open PDF', 'No compatible PDF viewer may be installed.')) },
      ]);
    } catch {
      Alert.alert('Unable to verify citation', 'The saved citation could not be verified against local records.');
    }
  }

  function confirmClearConversation() {
    Alert.alert('Clear Conversation?', 'Messages and citations in this thread will be deleted. Cases, documents, original files, and reusable indexes will remain.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clear Conversation', style: 'destructive', onPress: () => void clearConversation() },
    ]);
  }

  async function clearConversation() {
    const threadId = stateRef.current.threadId;
    if (!threadId) return;
    try {
      if (!(await clearAiConversation(threadId))) throw new Error('Thread missing');
      setConversationEntries([]);
      setFreshInsufficientMessageIds(new Set());
      setWarningsByMessageId(new Map());
      dispatch({ type: 'RESET_CHAT_REQUEST' });
      await refreshHome();
    } catch {
      Alert.alert('Unable to clear conversation', 'No case, document, or index data was changed.');
    }
  }

  function confirmResetConsent() {
    Alert.alert('Reset Online Consent?', 'Future online questions will require consent again. Local chats, cases, documents, and indexes will not be deleted.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Reset Consent', style: 'destructive', onPress: () => void resetConsent() },
    ]);
  }

  async function resetConsent() {
    try {
      await resetAiOnlineConsent();
      Alert.alert('Online consent reset', 'No local conversation or index data was deleted.');
    } catch {
      Alert.alert('Unable to reset consent', 'No local conversation or index data was changed.');
    }
  }

  async function reaffirmReviewedConsent() {
    try {
      await recordCurrentAiOnlineConsent(activePublicConfig?.privacy.consentVersion);
      setPolicyReviewVisible(false);
    } catch {
      Alert.alert('Unable to save consent', 'No excerpts were sent.');
    }
  }

  function isCurrentRequest(sequence: number, controller: AbortController): boolean {
    return isCurrentAiRequestSequence(sequence, requestSequence.current, controller.signal.aborted)
      && requestController.current === controller;
  }

  if (!initialized || (homeLoading && state.phase === 'home' && recentThreads.length === 0)) {
    return <AiLoadingState />;
  }

  if (state.phase === 'error') {
    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        <AppHeader title="AI Assistant" subtitle="Local source preparation" />
        <EmptyState icon="alert-circle-outline" title="AI tools unavailable" message={state.errorMessage ?? 'The local AI workspace could not be opened.'} actionLabel="Try Again" onAction={() => void initializeAiTab()} />
      </SafeAreaView>
    );
  }

  if (state.phase === 'case_selection') {
    return <SafeAreaView style={styles.screen} edges={['top']}><CaseSelector selectedIds={draftCaseIds} onChange={setDraftCaseIds} onContinue={continueFromCases} onCancel={() => dispatch({ type: 'GO_HOME' })} /></SafeAreaView>;
  }

  if (state.phase === 'document_selection') {
    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        <DocumentSelector
          cases={documentCases}
          choices={documentChoices}
          selectedIds={draftDocumentIds}
          loading={documentLoading}
          checkedCount={documentCheckedCount}
          totalCount={documentTotalCount}
          error={documentError}
          onChange={setDraftDocumentIds}
          onBack={backToCaseSelection}
          onContinue={startPreparation}
          onRetryLoad={() => void loadDocumentChoices(state.selectedCaseIds)}
        />
      </SafeAreaView>
    );
  }

  if (state.phase === 'preparing') {
    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        <IndexingProgress
          items={preparationItems}
          activeIndex={activePreparationIndex}
          running={preparationRunning}
          onCancel={() => preparationController.current?.abort()}
          onRetry={retryPreparation}
          onContinue={() => void finishPreparation()}
          onChangeSources={() => { setDraftDocumentIds([...state.selectedDocumentIds]); dispatch({ type: 'EDIT_DOCUMENTS' }); }}
        />
      </SafeAreaView>
    );
  }

  if (state.phase === 'search') {
    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        <LocalSearchPreview
          caseIds={state.selectedCaseIds}
          documentIds={state.selectedDocumentIds}
          cases={allCases}
          onBack={() => dispatch({ type: 'CLOSE_SEARCH' })}
          onOpenCitation={(result) => void openCitation(result)}
        />
      </SafeAreaView>
    );
  }

  if (state.phase === 'chat_loading') {
    return <AiLoadingState title="Restoring conversation" message="Loading saved messages and validating selected sources locally." />;
  }

  if (isChatUiPhase(state.phase)) {
    const backend = describeBackendState(backendState);
    return (
      <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
        <AiChatView
          title={state.threadTitle ?? 'Prepared Sources'}
          caseCount={state.selectedCaseIds.length}
          documentCount={state.selectedDocumentIds.length}
          readySourceCount={state.readySourceCount}
          backendLabel={backend.label}
          backendAvailable={backend.canSend}
          backendChecking={backendState.status === 'checking' || backendState.status === 'waking'}
          phase={state.phase}
          requestMessage={state.requestMessage}
          scopeChanged={state.scopeChanged}
          entries={conversationEntries}
          cases={conversationCases}
          documents={conversationDocuments}
          draft={questionDraft}
          freshInsufficientMessageIds={freshInsufficientMessageIds}
          warningsByMessageId={warningsByMessageId}
          onDraftChange={(value) => { setQuestionDraft(value); if (stateRef.current.phase === 'chat_cancelled') dispatch({ type: 'RESET_CHAT_REQUEST' }); }}
          onSend={(question) => void submitChatQuestion(question)}
          onCancel={cancelChatRequest}
          onRetry={retryChatRequest}
          onRetryBackend={() => void wakeBackendManually()}
          onOpenSearch={() => dispatch({ type: 'OPEN_SEARCH' })}
          onChangeSources={changeSources}
          onOpenMenu={showThreadMenu}
          onOpenCitation={(entry, citationIndex) => void openSavedCitation(entry, citationIndex)}
          onCopyAnswer={(content) => void copyAnswer(content)}
          onRegenerate={regenerateAnswer}
        />
        <AiOnlineConsent
          visible={state.phase === 'chat_awaiting_consent' || policyReviewVisible}
          evidence={state.phase === 'chat_awaiting_consent'
            ? pendingChatRequest.current?.prepared.evidence.map((item) => ({
              documentName: item.documentName,
              pageLabel: formatCitationPages(item.pageStart, item.pageEnd),
              excerpt: item.content,
            }))
            : undefined}
          providerDisplayName={pendingChatRequest.current?.publicConfig.providerDisplayName ?? activePublicConfig?.providerDisplayName}
          privacyNotice={pendingChatRequest.current?.publicConfig.privacy.notice ?? activePublicConfig?.privacy.notice}
          onCancel={() => state.phase === 'chat_awaiting_consent' ? cancelOnlineConsent() : setPolicyReviewVisible(false)}
          onConsent={() => {
            if (stateRef.current.phase === 'chat_awaiting_consent') void acceptOnlineConsent();
            else void reaffirmReviewedConsent();
          }}
        />
        <RenameModal target={renameTarget} value={renameValue} saving={renameSaving} onChange={setRenameValue} onCancel={() => setRenameTarget(null)} onSave={() => void saveRename()} />
        <ThreadMenuModal
          visible={threadMenuVisible}
          onClose={() => setThreadMenuVisible(false)}
          onRename={() => state.threadId && openRename({ id: state.threadId, title: state.threadTitle ?? 'Prepared Sources' })}
          onChangeSources={changeSources}
          onLocalSearch={() => dispatch({ type: 'OPEN_SEARCH' })}
          onReviewPolicy={() => setPolicyReviewVisible(true)}
          onResetConsent={confirmResetConsent}
          onClearConversation={confirmClearConversation}
          onReindex={reindexChangedDocuments}
          onRemoveSelected={confirmRemoveSelectedIndexes}
          onRemoveAll={confirmRemoveAllIndexes}
          onDeleteThread={() => state.threadId && confirmDeleteThread(state.threadId)}
        />
      </SafeAreaView>
    );
  }

  if (state.phase === 'ready') {
    const selectedDocumentSet = new Set(state.selectedDocumentIds);
    const selectedChoices = documentChoices.filter((choice) => selectedDocumentSet.has(choice.document.id));
    const readyCount = selectedChoices.filter((choice) => choice.status === 'ready').length;
    const warningCount = selectedChoices.filter((choice) => choice.status !== 'ready').length;
    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        <ScrollView contentContainerStyle={styles.readyContent}>
          <AppHeader
            title={state.threadTitle ?? 'Prepared Sources'}
            subtitle="AI Assistant · Local session"
            rightAction={<Pressable accessibilityRole="button" accessibilityLabel="Open session menu" onPress={showThreadMenu} style={styles.menuButton}><Ionicons name="ellipsis-vertical" size={22} color={colors.primary} /></Pressable>}
          />
          <AppCard style={styles.readyCard}>
            <View style={styles.readyIcon}><Ionicons name="checkmark-circle" size={30} color={colors.active} /></View>
            <Text style={styles.readyTitle}>Sources ready for local search</Text>
            <Text style={styles.readyScope}>{state.selectedCaseIds.length} Cases • {state.selectedDocumentIds.length} Documents Selected</Text>
            <View style={styles.readyStats}>
              <Stat value={readyCount} label="Ready sources" />
              <Stat value={warningCount} label="Warnings" />
            </View>
          </AppCard>
          <Notice />
          <PrimaryButton label="Search Prepared Sources" disabled={readyCount === 0 || documentLoading} onPress={() => dispatch({ type: 'OPEN_SEARCH' })} />
          <SecondaryAction icon="options-outline" label="Change Sources" onPress={changeSources} />
          <SecondaryAction icon="refresh-outline" label="Re-index Changed Documents" onPress={reindexChangedDocuments} />
          {warningCount > 0 ? <Text style={styles.warningNote}>{warningCount} selected source(s) need attention. Change sources to review missing, OCR-required, unsupported, or failed documents.</Text> : null}
        </ScrollView>
        <RenameModal target={renameTarget} value={renameValue} saving={renameSaving} onChange={setRenameValue} onCancel={() => setRenameTarget(null)} onSave={() => void saveRename()} />
        <ThreadMenuModal
          visible={threadMenuVisible}
          onClose={() => setThreadMenuVisible(false)}
          onRename={() => state.threadId && openRename({ id: state.threadId, title: state.threadTitle ?? 'Prepared Sources' })}
          onChangeSources={changeSources}
          onLocalSearch={() => dispatch({ type: 'OPEN_SEARCH' })}
          onReviewPolicy={() => setPolicyReviewVisible(true)}
          onResetConsent={confirmResetConsent}
          onClearConversation={confirmClearConversation}
          onReindex={reindexChangedDocuments}
          onRemoveSelected={confirmRemoveSelectedIndexes}
          onRemoveAll={confirmRemoveAllIndexes}
          onDeleteThread={() => state.threadId && confirmDeleteThread(state.threadId)}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScrollView contentContainerStyle={styles.homeContent}>
        <AppHeader title="AI Assistant" subtitle="Prepare and search case documents locally" />
        <AppCard style={styles.introCard}>
          <View style={styles.assistantIcon}><Ionicons name="sparkles" size={28} color={colors.primary} /></View>
          <Text style={styles.introTitle}>Work with your selected sources</Text>
          <Text style={styles.introText}>Choose cases and documents, prepare selectable PDF text, and preview scoped search results with page citations.</Text>
          <PrimaryButton label="Select Cases" onPress={startNewSelection} />
        </AppCard>
        <Notice />
        <View style={styles.sessionsHeader}>
          <Text style={styles.sectionTitle}>Recent Prepared Sessions</Text>
          {homeLoading ? <ActivityIndicator color={colors.primary} /> : null}
        </View>
        {recentThreads.length === 0 ? (
          <EmptyState icon="albums-outline" title="No prepared sessions yet" message="Select cases and prepare at least one usable document to create a local session." />
        ) : recentThreads.map((thread) => (
          <AppCard key={thread.id} onPress={() => void resumeThread(thread.id)} accessibilityLabel={`Resume ${thread.title}`} style={styles.sessionCard}>
            <View style={styles.sessionTop}>
              <View style={styles.sessionTitleWrap}>
                <Text style={styles.sessionTitle} numberOfLines={2}>{thread.title}</Text>
                <Text style={styles.sessionMeta}>{thread.caseCount} cases · {thread.documentCount} documents</Text>
                <Text style={[styles.sessionStatus, { color: thread.readySourceCount > 0 ? colors.active : colors.pending }]}>{thread.readySourceCount > 0 ? `${thread.readySourceCount} usable indexed sources` : 'No usable indexed sources remain'}</Text>
                <Text style={styles.sessionDate}>Updated {formatDisplayDateTime(thread.updatedAt)}</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
            </View>
            <View style={styles.sessionActions}>
              <Pressable accessibilityRole="button" accessibilityLabel={`Rename ${thread.title}`} onPress={(event) => { event.stopPropagation(); openRename({ id: thread.id, title: thread.title }); }} style={styles.smallAction}><Ionicons name="create-outline" size={17} color={colors.primary} /><Text style={styles.smallActionText}>Rename</Text></Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel={`Delete ${thread.title}`} onPress={(event) => { event.stopPropagation(); confirmDeleteThread(thread.id); }} style={styles.smallAction}><Ionicons name="trash-outline" size={17} color={colors.danger} /><Text style={[styles.smallActionText, { color: colors.danger }]}>Delete</Text></Pressable>
            </View>
          </AppCard>
        ))}
      </ScrollView>
      <RenameModal target={renameTarget} value={renameValue} saving={renameSaving} onChange={setRenameValue} onCancel={() => setRenameTarget(null)} onSave={() => void saveRename()} />
    </SafeAreaView>
  );
}

function Notice() {
  return (
    <View style={styles.notice}>
      <Ionicons name="shield-checkmark-outline" size={22} color={colors.primary} />
      <Text style={styles.noticeText}>Documents are prepared and searched on this device. Online answers are optional: only locally selected excerpts are sent after consent; original files are not uploaded.</Text>
    </View>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return <View style={styles.stat}><Text style={styles.statValue}>{value}</Text><Text style={styles.statLabel}>{label}</Text></View>;
}

function SecondaryAction({ icon, label, onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [styles.secondaryAction, pressed && styles.pressed]}><Ionicons name={icon} size={20} color={colors.primary} /><Text style={styles.secondaryActionText}>{label}</Text></Pressable>;
}

function AiLoadingState({ title = 'Opening local AI workspace', message = 'No documents are prepared until you select them.' }: { title?: string; message?: string }) {
  return <SafeAreaView style={styles.screen} edges={['top']}><View style={styles.loading}><ActivityIndicator size="large" color={colors.primary} /><Text style={styles.loadingTitle}>{title}</Text><Text style={styles.loadingText}>{message}</Text></View></SafeAreaView>;
}

function RenameModal(props: { target: RenameTarget | null; value: string; saving: boolean; onChange: (value: string) => void; onCancel: () => void; onSave: () => void }) {
  return (
    <Modal visible={Boolean(props.target)} transparent animationType="fade" onRequestClose={props.onCancel}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>Rename Prepared Session</Text>
          <TextInput value={props.value} onChangeText={props.onChange} autoFocus maxLength={120} accessibilityLabel="Prepared session title" style={styles.modalInput} />
          <View style={styles.modalActions}>
            <Pressable accessibilityRole="button" onPress={props.onCancel} style={styles.modalButton}><Text style={styles.modalCancel}>Cancel</Text></Pressable>
            <Pressable accessibilityRole="button" disabled={!props.value.trim() || props.saving} onPress={props.onSave} style={[styles.modalButton, styles.modalSave, (!props.value.trim() || props.saving) && styles.disabled]}><Text style={styles.modalSaveText}>{props.saving ? 'Saving…' : 'Save'}</Text></Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function ThreadMenuModal(props: {
  visible: boolean;
  onClose: () => void;
  onRename: () => void;
  onChangeSources: () => void;
  onLocalSearch: () => void;
  onReviewPolicy: () => void;
  onResetConsent: () => void;
  onClearConversation: () => void;
  onReindex: () => void;
  onRemoveSelected: () => void;
  onRemoveAll: () => void;
  onDeleteThread: () => void;
}) {
  const actions = [
    { icon: 'create-outline', label: 'Rename Session', action: props.onRename, danger: false },
    { icon: 'search-outline', label: 'Search Prepared Sources Locally', action: props.onLocalSearch, danger: false },
    { icon: 'options-outline', label: 'Change Sources', action: props.onChangeSources, danger: false },
    { icon: 'refresh-outline', label: 'Re-index Changed Documents', action: props.onReindex, danger: false },
    { icon: 'shield-checkmark-outline', label: 'Review Online Data Policy', action: props.onReviewPolicy, danger: false },
    { icon: 'refresh-circle-outline', label: 'Reset Online Consent', action: props.onResetConsent, danger: true },
    { icon: 'chatbox-ellipses-outline', label: 'Clear Conversation', action: props.onClearConversation, danger: true },
    { icon: 'remove-circle-outline', label: 'Remove Selected Indexes', action: props.onRemoveSelected, danger: true },
    { icon: 'trash-bin-outline', label: 'Delete All Local AI Indexes', action: props.onRemoveAll, danger: true },
    { icon: 'trash-outline', label: 'Delete Session', action: props.onDeleteThread, danger: true },
  ] as const;
  return (
    <Modal visible={props.visible} transparent animationType="fade" onRequestClose={props.onClose}>
      <Pressable accessibilityRole="button" accessibilityLabel="Close session menu" onPress={props.onClose} style={styles.modalBackdrop}>
        <Pressable accessibilityRole="menu" onPress={() => undefined} style={styles.threadMenuCard}>
          <Text style={styles.modalTitle}>Prepared Session</Text>
          <Text style={styles.threadMenuDescription}>Manage the local session and derived search indexes.</Text>
          <ScrollView style={styles.threadMenuScroll}>
            {actions.map((item) => (
              <Pressable
                key={item.label}
                accessibilityRole="menuitem"
                onPress={() => { props.onClose(); item.action(); }}
                style={({ pressed }) => [styles.threadMenuAction, pressed && styles.pressed]}
              >
                <Ionicons name={item.icon} size={20} color={item.danger ? colors.danger : colors.primary} />
                <Text style={[styles.threadMenuLabel, item.danger && styles.threadMenuDanger]}>{item.label}</Text>
              </Pressable>
            ))}
          </ScrollView>
          <Pressable accessibilityRole="button" onPress={props.onClose} style={styles.threadMenuCancel}><Text style={styles.modalCancel}>Close</Text></Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function mergePreparationItems(base: readonly AiPreparationItem[], updates: readonly AiPreparationItem[]): AiPreparationItem[] {
  const updateMap = new Map(updates.map((item) => [item.documentId, item]));
  const merged = base.map((item) => updateMap.get(item.documentId) ?? item);
  const baseIds = new Set(base.map((item) => item.documentId));
  for (const item of updates) if (!baseIds.has(item.documentId)) merged.push(item);
  return merged;
}

function isChatUiPhase(phase: ReturnType<typeof aiAssistantReducer>['phase']): boolean {
  return phase === 'chat_ready'
    || phase === 'chat_retrieving'
    || phase === 'chat_preparing'
    || phase === 'chat_awaiting_consent'
    || phase === 'chat_connecting'
    || phase === 'chat_generating'
    || phase === 'chat_validating'
    || phase === 'chat_saving'
    || phase === 'chat_completed'
    || phase === 'chat_cancelled'
    || phase === 'chat_request_error'
    || phase === 'sources_invalidated';
}

function describeBackendState(state: BackendUiState): { label: string; canSend: boolean } {
  const values: Record<BackendUiState['status'], { label: string; canSend: boolean }> = {
    unchecked: { label: 'Online backend configured · checked before sending', canSend: true },
    checking: { label: 'Checking the online backend…', canSend: false },
    waking: { label: 'Starting AI service—this may take up to a minute. Retry the question after this succeeds.', canSend: false },
    healthy: { label: 'Online backend available', canSend: true },
    device_offline: { label: 'Device offline · local search available', canSend: false },
    not_configured: { label: 'Local-only mode · backend URL missing', canSend: false },
    invalid_configuration: { label: 'Online backend URL is invalid or insecure', canSend: false },
    backend_unreachable: { label: 'Online backend unreachable · local search available', canSend: false },
    provider_not_configured: { label: 'Backend available · provider not configured', canSend: false },
    timed_out: { label: 'Online backend check timed out', canSend: false },
    invalid_response: { label: 'Online backend returned an invalid health response', canSend: false },
  };
  return values[state.status];
}

function backendCanAttempt(state: BackendUiState): boolean {
  return state.status === 'unchecked' || state.status === 'healthy';
}

function assertBackendAvailable(state: AiBackendAvailability): asserts state is Extract<AiBackendAvailability, { status: 'healthy' }> {
  if (state.status === 'healthy') return;
  if (state.status === 'device_offline' || state.status === 'backend_unreachable') {
    throw new AiAnswerApiError('NETWORK_UNAVAILABLE', 'The AI backend is unavailable.');
  }
  if (state.status === 'timed_out') throw new AiAnswerApiError('PROVIDER_TIMEOUT', 'The backend check timed out.');
  if (state.status === 'provider_not_configured' || state.status === 'not_configured' || state.status === 'invalid_configuration') {
    throw new AiAnswerApiError('PROVIDER_NOT_CONFIGURED', 'The online provider is not configured.');
  }
  throw new AiAnswerApiError('INVALID_PROVIDER_RESPONSE', 'The backend health response is invalid.');
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  homeContent: { gap: spacing.xl, paddingBottom: spacing.xxxl },
  introCard: { gap: spacing.md, marginHorizontal: spacing.xl, padding: spacing.xl },
  assistantIcon: { width: 52, height: 52, alignItems: 'center', justifyContent: 'center', borderRadius: radius.lg, backgroundColor: colors.primarySoft },
  introTitle: { ...typography.heading, color: colors.text },
  introText: { ...typography.body, color: colors.textMuted },
  notice: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, marginHorizontal: spacing.xl, padding: spacing.lg, borderRadius: radius.md, backgroundColor: colors.primarySoft },
  noticeText: { ...typography.caption, flex: 1, color: colors.text },
  sessionsHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.xl },
  sectionTitle: { ...typography.subheading, color: colors.text },
  sessionCard: { gap: spacing.md, marginHorizontal: spacing.xl },
  sessionTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  sessionTitleWrap: { flex: 1, gap: 3 },
  sessionTitle: { ...typography.bodyStrong, color: colors.text },
  sessionMeta: { ...typography.caption, color: colors.textMuted },
  sessionStatus: { ...typography.caption, fontWeight: '600' },
  sessionDate: { ...typography.caption, color: colors.textMuted },
  sessionActions: { flexDirection: 'row', gap: spacing.lg, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.divider, paddingTop: spacing.sm },
  smallAction: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  smallActionText: { ...typography.caption, fontWeight: '600', color: colors.primary },
  readyContent: { gap: spacing.lg, paddingBottom: spacing.xxxl },
  menuButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill, backgroundColor: colors.primarySoft },
  readyCard: { alignItems: 'center', gap: spacing.sm, marginHorizontal: spacing.xl, padding: spacing.xl },
  readyIcon: { width: 56, height: 56, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill, backgroundColor: colors.activeBackground },
  readyTitle: { ...typography.heading, textAlign: 'center', color: colors.text },
  readyScope: { ...typography.body, textAlign: 'center', color: colors.textMuted },
  readyStats: { width: '100%', flexDirection: 'row', gap: spacing.md, marginTop: spacing.sm },
  stat: { flex: 1, alignItems: 'center', padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.background },
  statValue: { ...typography.heading, color: colors.text },
  statLabel: { ...typography.caption, textAlign: 'center', color: colors.textMuted },
  secondaryAction: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, marginHorizontal: spacing.xl, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface },
  secondaryActionText: { ...typography.bodyStrong, color: colors.primary },
  warningNote: { ...typography.caption, marginHorizontal: spacing.xl, color: colors.pending },
  pressed: { opacity: 0.75 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.xl },
  loadingTitle: { ...typography.subheading, color: colors.text },
  loadingText: { ...typography.body, textAlign: 'center', color: colors.textMuted },
  modalBackdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, backgroundColor: 'rgba(23, 33, 43, 0.42)' },
  modalCard: { width: '100%', maxWidth: 420, gap: spacing.lg, padding: spacing.xl, borderRadius: radius.lg, backgroundColor: colors.surface },
  modalTitle: { ...typography.heading, color: colors.text },
  modalInput: { minHeight: 48, paddingHorizontal: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, color: colors.text, ...typography.body },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm },
  modalButton: { minWidth: 88, minHeight: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.md, borderRadius: radius.md },
  modalSave: { backgroundColor: colors.primary },
  modalCancel: { ...typography.bodyStrong, color: colors.primary },
  modalSaveText: { ...typography.bodyStrong, color: colors.surface },
  threadMenuCard: { width: '100%', maxWidth: 440, maxHeight: '88%', padding: spacing.xl, borderRadius: radius.lg, backgroundColor: colors.surface },
  threadMenuScroll: { flexShrink: 1 },
  threadMenuDescription: { ...typography.caption, marginTop: spacing.xs, marginBottom: spacing.md, color: colors.textMuted },
  threadMenuAction: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.divider },
  threadMenuLabel: { ...typography.bodyStrong, flex: 1, color: colors.text },
  threadMenuDanger: { color: colors.danger },
  threadMenuCancel: { minHeight: 48, alignItems: 'center', justifyContent: 'center', marginTop: spacing.sm },
  disabled: { opacity: 0.5 },
});
