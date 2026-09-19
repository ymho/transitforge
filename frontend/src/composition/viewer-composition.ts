import { currentAuthentication } from "./auth-composition";
import { consultationTransport } from "./agent-cutover-policy";
import { createConversationStreamSession } from "../adapters/http/agent-stream/session";

import mapboxgl from "mapbox-gl";
import { placeCameraOffset } from "../presentation/place-explorer/place-camera-offset";
import { accommodationProviderAttributionFromEnvironment } from "../adapters/browser/accommodation-provider-attribution";
import { browserDigitalTwinClockEnvironment } from "../adapters/browser/digital-twin-clock-environment";
import { browserPollingEnvironment } from "../adapters/browser/polling-controller";
import { createRuntimeMonitor, nextBrowserFrame } from "../adapters/browser/runtime-monitor";
import { applyWeather } from "../adapters/mapbox/map-weather";
import { createLocalWeatherLayer } from "../adapters/mapbox/local-weather-layer";
import { createGroundAccessLayer, type GroundAccessLayerController } from "../adapters/mapbox/ground-access-layer";
import {
  createVerifiedPlaceLayer,
  type VerifiedPlaceLayerController,
} from "../adapters/mapbox/place-media-layer";
import {
  congestionRefreshIntervalMilliseconds,
  congestionRetryIntervalMilliseconds,
  loadTrainCongestion,
} from "../adapters/http/traffic/train-congestion";
import {
  loadTrainDelays,
  trainDelayRefreshIntervalMilliseconds,
  trainDelayRetryIntervalMilliseconds,
} from "../adapters/http/traffic/train-delay";
import {
  loadPathCatalog,
  toRouteFeatureCollections,
} from "../adapters/http/viewer-input/path-catalog";
import { emptyStationLineCatalog } from "../adapters/http/viewer-input/station-line-catalog";
import { researchPlaceDetail, searchWeatherGrid } from "../adapters/http/agent-api/bedrock-agent";
import { loadTrainIndex } from "../adapters/http/viewer-input/train-index";
import type { TrainDelaySnapshot, TrainOperation } from "@raiquora/operation/operation";
import {
  dateForOperatingRouteTime,
  operatingServiceDateStart,
  stepDisplayDateTime,
} from "../domain/display-date-time";
import {
  lightPresetForRouteTime,
  type LightPreset,
} from "../domain/map-lighting";
import type { WeatherMode } from "../domain/weather";
import { dominantLineColorsByPathId } from "../domain/path-line-colors";
import { currentRouteTime } from "../domain/playback";
import { TrainFocusReturnContextSession } from "../domain/train-focus-return-context";
import {
  coupledTrainLayouts,
  trainHitTargetsFor,
} from "../domain/coupled-train-layout";
import { TrainLineColorIndex } from "../domain/train-line-color";
import { trainFormationLinks } from "../domain/train-formation-link";
import {
  delayByTrainNumber,
  destinationChangedServiceUids,
  operationsForDisplay,
  operationsWithCoupledTrainOperations,
  operationsWithTimetableTrainNumberAliases,
  trainsForOperations,
} from "@raiquora/operation/train-operation-state";
import {
  activeTrainPositions,
  destinationCoordinateForTrain,
  freezeLongTimeStoppingPositions,
  PathGeometryIndex,
} from "../domain/train-position";
import type { TrainPosition } from "../domain/train-position";
import { loadViewerElements } from "../usecases/viewer/viewer-elements";
import { resolveViewerDisplayMode } from "../domain/viewer-display-mode";
import { configureAiFirstShell } from "../presentation/home/ai-first-shell";
import { configureConsultationScreen } from "../presentation/home/consultation-screen";

import {
  configureAiGuidePanel,
  type AiGuidePromptHandler,
} from "../presentation/concierge/ai-guide-panel";
import { configureLandmarkJourneyInteraction } from "../presentation/concierge/landmark-journey-interaction";
import { configureTrainSelection } from "../presentation/train-viewer/train-selection-controller";
import {
  configureTrainCongestionUpdates,
  configureTrainDelayUpdates,
} from "../usecases/train-viewer/realtime-updates";
import { configureLocalWeatherUpdates } from "../usecases/train-viewer/local-weather-updates";
import {
  configureDateTimeInput,
  maximumRouteTimeFor,
  renderDisplayDateTime,
} from "../presentation/train-viewer/date-time-control";
import {
  configurePlayback,
  configurePlaybackSpeed,
  type PlaybackUiController,
} from "../presentation/train-viewer/playback-controls";
import {
  configureDestinationArcs,
  renderDisplayMode,
  configureSidebarMapModeSelection,
} from "../presentation/train-viewer/map-controls";
import { createLoadingScreen } from "../presentation/shared/loading-screen";
import {
  configureMapPlaceExplorer,
  type MapPlaceExplorerController,
} from "../presentation/place-explorer/map-place-explorer";
import { MapboxThreeTrainLayer } from "../presentation/train-viewer/rendering/mapbox-three-train-layer";
import { RuntimeMetrics } from "../observability/runtime-metrics";
import { configureTravelProfile } from "../presentation/concierge/travel-profile-panel";
import { HttpServerProfileClient } from "../adapters/http/server-profile-client";
import { ProfileUiController } from "../usecases/personal-state/profile-ui-controller";
import { HttpServerConversationClient } from "../adapters/http/server-conversation-client";
import { ConversationUiController } from "../usecases/personal-state/conversation-ui-controller";
import { configureConversationHistoryPanel } from "../presentation/concierge/conversation-history-panel";
import { configureApplicationSettingsPanel } from "../presentation/settings/application-settings-panel";
import { configureTripPlanPanel } from "../presentation/trip-plan/trip-plan-panel";
import { createTripWorkspaceController } from "../usecases/trip-plan/trip-workspace-controller";
import { createReferencedTripSource } from "../usecases/trip-plan/server-trip-workspace-source";
import { HttpServerTripClient } from "../adapters/http/server-trip-client";
import { HttpNotificationClient } from "../adapters/http/notification-client";
import { configureNotificationCenter } from "../presentation/notifications/notification-center";
import { configureTripSharing } from "../presentation/trip-plan/trip-sharing-panel";
import "../presentation/trip-plan/trip-sharing-panel.css";
import { HttpTripSharingClient } from "../adapters/http/trip-sharing-client";
import { consumeTripShareLink, makeTripShareLink, parseTripShareLink } from "../adapters/browser/trip-share-link";
import { configureTripWorkspace } from "../presentation/trip-plan/trip-workspace";
import { tripPlanFromTravelPlan } from "@raiquora/trip/trip-plan";
import { loadTripPlan } from "../usecases/trip-plan/trip-plan-repository";
import { BrowserContextWorkspaceRepository } from "../adapters/browser/context-workspace-repository";
import type { ConversationSession } from "../domain/conversation-session";
import { createContextWorkspaceController } from "../usecases/context-workspace/context-workspace-controller";
import { createMobileContextNavigation } from "../presentation/concierge/mobile-context-navigation";
import {
  mapAccommodationCandidates,
  mapCandidateAsPlaceMedia,
  mergeMapPlaceDetailCandidate,
  mapPlaceCandidates,
  mapRestaurantCandidates,
  type MapTravelCandidate,
} from "../domain/map-travel-candidate";

export async function startViewer(): Promise<void> {
const initialShareLink = consumeTripShareLink(window.location, window.history);

const realtimeUpdateDependencies = {
  pollingEnvironment: browserPollingEnvironment,
  loadCongestion: loadTrainCongestion,
  congestionRefreshIntervalMilliseconds,
  congestionRetryIntervalMilliseconds,
  loadDelays: loadTrainDelays,
  delayRefreshIntervalMilliseconds: trainDelayRefreshIntervalMilliseconds,
  delayRetryIntervalMilliseconds: trainDelayRetryIntervalMilliseconds,
};

const token = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN;
const {
  app,
  loadingScreenElement,
  loadingScreenMessage,
  loadingScreenRetry,
  status,
  contextWorkspaceTabs,
  closeContextWorkspace,
  displayTime,
  dateTimeInput,
  dateTimeDate,
  dateTimeClock,
  playToggle,
  currentTimeButton,
  playbackSpeed,
  playbackSpeedMenuToggle,
  playbackSpeedOptions,
  playbackSpeedButtons,
  mapTools,
  mapPlaceExplorer,
  mapPlaceExplorerList,
  closeMapPlaceExplorer,
  mapPlaceDetail,
  mapPlaceDetailContent,
  closeMapPlaceDetail,
  congestionToggle,
  destinationArcsToggle,
  digitalTwinModeToggle,
  aiGuidePanel,
  aiGuideToggle,
  closeAiGuide,
  aiGuideMessages,
  aiGuideForm,
  aiGuideInput,
  aiGuideSubmit,
  railNewConversation,
  railConversationHistory,
  railRealtimeMap,
  railDateTimeMode,
  sidebarRealtimeMap,
  sidebarDateTimeMode,
  travelProfileToggle,
  newConversation,
  conversationHistoryToggle,
  conversationHistoryDialog,
  closeConversationHistory,
  conversationHistoryList,
  conversationHistoryEmpty,
  aiGuideSuggestions,
  aiGuideContextChoices,
  journeySettingsToggle,
  journeySettingsPanel,
  journeyTransferPace,
  journeyRankingPreference,
  tripPlanToggle,
  tripPlanPanel,
  tripPlanContent,
  closeTripPlan,
  trainDetails,
  closeTrainDetails,
  selectedTrainTitle,
  selectedTrainDelay,
  selectedTrainStopping,
  selectedTrainStops,
  trainDetailTabs,
} = loadViewerElements(document);
const dateTimeDisplayElements = {
  input: dateTimeInput,
  date: dateTimeDate,
  clock: dateTimeClock,
};
const metrics = new RuntimeMetrics();
const runtimeMonitor = createRuntimeMonitor(metrics);

const loadingScreen = createLoadingScreen({
  app,
  screen: loadingScreenElement,
  message: loadingScreenMessage,
  retry: loadingScreenRetry,
});
loadingScreenRetry.addEventListener("click", () => window.location.reload());

let resolveAiGuidePromptHandler: (handler: AiGuidePromptHandler) => void = () => undefined;
const aiGuidePromptHandlerReady = new Promise<AiGuidePromptHandler>((resolve) => {
  resolveAiGuidePromptHandler = resolve;
});
let handleAiGuidePrompt: AiGuidePromptHandler = (...args) =>
  aiGuidePromptHandlerReady.then((handler) => handler(...args));
// Consultation transport remains separately gated; Conversation persistence is always server-owned.
const serverAgentEnabled = import.meta.env.VITE_SERVER_AGENT_ENABLED === "true";
const consultationTransportMode = consultationTransport(serverAgentEnabled);
const canUsePersonalState = () => currentAuthentication().getState().status === "signed-in";
const conversationUi = new ConversationUiController(new HttpServerConversationClient(), canUsePersonalState);
const profileUi = new ProfileUiController(new HttpServerProfileClient(), canUsePersonalState);
const unsignedConversation: ConversationSession = {
  id: "ui-unauthenticated", title: "新しい会話", scope: "general", summary: "", resolvedTopics: [], pendingTopics: [],
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
};
let activeConversationSession = unsignedConversation;
const isSignedIn = canUsePersonalState;
if (isSignedIn()) {
  try {
    activeConversationSession = (await conversationUi.hydrate()) ?? await conversationUi.create();
    await conversationUi.loadHistory(activeConversationSession.id);
    await profileUi.hydrate();
  } catch { conversationUi.clear(); profileUi.clear(); }
}
let aiGuideController: ReturnType<typeof configureAiGuidePanel>;
let verifiedPlaceLayer: VerifiedPlaceLayerController | undefined;
let mapPlaceExplorerController: MapPlaceExplorerController | undefined;
let groundAccessLayer: GroundAccessLayerController | undefined;
let pendingMapCandidates: MapTravelCandidate[] = [];
const tripPreviewEnabled = import.meta.env.DEV &&
  new URLSearchParams(window.location.search).get("trip-preview") === "1";
const weatherPreviewEnabled = import.meta.env.DEV &&
  new URLSearchParams(window.location.search).get("weather-preview") === "mixed";
const mobileChatShell = window.matchMedia("(max-width: 71.999rem)");
const contextWorkspaceController = createContextWorkspaceController(
  activeConversationSession.id,
  new BrowserContextWorkspaceRepository(localStorage),
);
const tripWorkspaceController = createTripWorkspaceController(activeConversationSession.id);
const serverAgentSession = serverAgentEnabled ? createConversationStreamSession({
  auth: currentAuthentication(), references: () => ({ conversationId: activeConversationSession.id,
    tripId: tripWorkspaceController.current()?.id, tripRevision: tripWorkspaceController.current()?.revision,
    itemId: tripWorkspaceController.uiFocus()?.itemId }),
}) : undefined;
tripWorkspaceController.subscribe(() => serverAgentSession?.contextChanged());

const serverTripClient = new HttpServerTripClient();
const serverTripReferences = new Map<string, string>();
const syncServerTripSource = (session: typeof activeConversationSession) => {
  if (!session.tripId && !session.tripSourceState) return;
  const key = `${session.tripSourceState}:${session.tripId ?? ""}`;
  if (serverTripReferences.get(session.id) === key) return;
  serverTripReferences.set(session.id, key);
  const source = createReferencedTripSource(session, serverTripClient);
  if (source) tripWorkspaceController.attach(session.id, source);
};
syncServerTripSource(activeConversationSession);
const tripPlanController = configureTripPlanPanel(
  tripPlanPanel,
  tripPlanContent,
  closeTripPlan,
  tripPlanToggle,
  activeConversationSession.id,
  (prompt) => {
    contextWorkspaceController.show("map");
    aiGuideController.ask(prompt);
  },
  localStorage,
  (accommodations, stay) => {
    const candidates = mapAccommodationCandidates(accommodations);
    if (candidates.length === 0) {
      aiGuideController.ask(
        `${stay.checkInDate}から${stay.checkOutDate}までの${stay.destination}の宿泊先を、地図で比較できる座標付き候補として探したい`,
      );
      return;
    }
    pendingMapCandidates = candidates;
    verifiedPlaceLayer?.show(candidates.map(mapCandidateAsPlaceMedia));
    mapPlaceExplorerController?.show(candidates);
    contextWorkspaceController.show("map");
  },
  () => !tripWorkspaceController.blocksLegacy(),
);
let resizeContextMap: () => void = () => undefined;
let primaryShell: ReturnType<typeof configureAiFirstShell> | undefined;
let startMap: () => void = () => undefined;
const scheduleContextMapResize = () => {
  requestAnimationFrame(() => resizeContextMap());
};
type SidebarMapMode = "realtime" | "date-time";
let pendingSidebarMapMode: SidebarMapMode | undefined;
let applySidebarMapMode: (mode: SidebarMapMode) => void = () => undefined;
configureSidebarMapModeSelection({
  app,
  realtimeModeButtons: [sidebarRealtimeMap, railRealtimeMap],
  dateTimeModeButtons: [sidebarDateTimeMode, railDateTimeMode],
});
const focusMapWorkspace = () => {
  if (app.dataset.primaryView !== "map") primaryShell?.showMap("realtime");
  startMap();
  contextWorkspaceController.show("map");
  app.dataset.mapFocusMode = "true";
  if (mobileChatShell.matches) {
    if (conversationHistoryDialog.open) conversationHistoryDialog.close();
    mobileContextNavigation.open("map");
  }
  scheduleContextMapResize();
};
const selectSidebarMapMode = (mode: SidebarMapMode) => {
  pendingSidebarMapMode = mode;
  focusMapWorkspace();
  applySidebarMapMode(mode);
};
const mobileContextNavigation = createMobileContextNavigation({
  app,
  messages: aiGuideMessages,
  input: aiGuideInput,
  showContext: (view) => contextWorkspaceController.show(view),
  restoreFocus: () => window.matchMedia("(pointer: fine)").matches,
});
const returnToConversation = () => {
  if (app.dataset.primaryView === "map") primaryShell?.navigate("chat");
  delete app.dataset.mapFocusMode;
  if (mobileContextNavigation.isOpen()) mobileContextNavigation.close();
  scheduleContextMapResize();
};
const applyContextWorkspaceState = () => {
  const state = contextWorkspaceController.current();
  if (state.view !== "map") delete app.dataset.mapFocusMode;
  app.dataset.contextView = state.view;
  if (tripWorkspaceController.blocksLegacy()) {
    tripPlanPanel.hidden = true;
    tripPlanToggle.hidden = true;
    if (state.view !== "journey-details" && !trainDetails.hidden) closeTrainDetails.click();
    scheduleContextMapResize();
    return;
  }
  const currentTripPlan = loadTripPlan(localStorage, state.conversationSessionId);
  if (state.view === "trip-plan" && currentTripPlan) {
    if (!trainDetails.hidden) closeTrainDetails.click();
    tripPlanController.open();
    scheduleContextMapResize();
    return;
  }
  if (!tripPlanPanel.hidden) tripPlanPanel.hidden = true;
  if (state.view === "map" && !trainDetails.hidden) closeTrainDetails.click();
  scheduleContextMapResize();
};
contextWorkspaceController.subscribe(applyContextWorkspaceState);
tripPlanToggle.addEventListener("click", () => {
  const currentTripPlan = loadTripPlan(
    localStorage,
    contextWorkspaceController.current().conversationSessionId,
  );
  if (!currentTripPlan) return;
  contextWorkspaceController.show("trip-plan", {
    kind: "trip-plan",
    id: currentTripPlan.id,
  });
});
closeContextWorkspace.addEventListener("click", () => {
  if (app.dataset.mapFocusMode === "true") {
    delete app.dataset.mapFocusMode;
    if (mobileChatShell.matches) mobileContextNavigation.close();
    scheduleContextMapResize();
    return;
  }
  mobileContextNavigation.close();
});
contextWorkspaceTabs.hidden = false;
conversationHistoryToggle.addEventListener("click", scheduleContextMapResize);
closeConversationHistory.addEventListener("click", scheduleContextMapResize);
railConversationHistory.addEventListener("click", () => conversationHistoryToggle.click());
railRealtimeMap.addEventListener("click", () => selectSidebarMapMode("realtime"));
sidebarRealtimeMap.addEventListener("click", () => selectSidebarMapMode("realtime"));
railDateTimeMode.addEventListener("click", () => selectSidebarMapMode("date-time"));
sidebarDateTimeMode.addEventListener("click", () => selectSidebarMapMode("date-time"));
closeTripPlan.addEventListener("click", () => {
  if (mobileChatShell.matches) mobileContextNavigation.close();
  else contextWorkspaceController.show("map");
});
aiGuideController = configureAiGuidePanel(
  {
    conversationSessionId: activeConversationSession.id,
    panel: aiGuidePanel,
    toggle: aiGuideToggle,
    close: closeAiGuide,
    messages: aiGuideMessages,
    form: aiGuideForm,
    input: aiGuideInput,
    submit: aiGuideSubmit,
    suggestions: aiGuideSuggestions,
    contextChoices: aiGuideContextChoices,
    settingsToggle: journeySettingsToggle,
    settingsPanel: journeySettingsPanel,
    transferPace: journeyTransferPace,
    rankingPreference: journeyRankingPreference,
    storage: localStorage,
    historyRepository: conversationUi.historyRepository,
    onFirstPrompt: (prompt) => {
      if (activeConversationSession.title !== "新しい会話") return;
      void conversationUi.rename(activeConversationSession.id, prompt.slice(0, 32))
        .then((renamed) => { activeConversationSession = renamed; })
        .catch(() => undefined);
    },
    onTravelPlan: (plan) => {
      if (tripWorkspaceController.blocksLegacy()) return; // Also blocked while loading/unavailable.
      const tripPlan = tripPlanFromTravelPlan(
        plan,
        new Date(),
        `trip-${crypto.randomUUID()}`,
      );
      tripPlanController.show(tripPlan);
      contextWorkspaceController.show("trip-plan", {
        kind: "trip-plan",
        id: tripPlan.id,
      });
    },
    onPlaces: (places) => {
      const candidates = mapPlaceCandidates(places);
      pendingMapCandidates = candidates;
      if (candidates.length === 0) {
        mapPlaceExplorerController?.clear();
        verifiedPlaceLayer?.clear();
        return;
      }
      verifiedPlaceLayer?.show(candidates.map(mapCandidateAsPlaceMedia));
      mapPlaceExplorerController?.show(candidates);
      contextWorkspaceController.show("map");
    },
    onGroundAccess: (access) => {
      groundAccessLayer?.show(access);
      contextWorkspaceController.show("map");
    },
    onRestaurantConsult: (restaurant) => {
      aiGuideController.ask(`${restaurant.name}を食事候補として旅程に入れたい`);
    },
    onRestaurants: (restaurants) => {
      const candidates = mapRestaurantCandidates(restaurants);
      pendingMapCandidates = candidates;
      if (candidates.length === 0) return;
      verifiedPlaceLayer?.show(candidates.map(mapCandidateAsPlaceMedia));
      mapPlaceExplorerController?.show(candidates);
      contextWorkspaceController.show("map");
    },
    persistent: () => true,
    responseContextKey: () => JSON.stringify([serverAgentSession?.contextVersion(), activeConversationSession.id, tripWorkspaceController.current()?.id, tripWorkspaceController.current()?.revision]),
    onTripPlanUpdate: (proposal) => {
      if (tripWorkspaceController.blocksLegacy()) return;
      tripPlanController.apply(proposal.patches);
      void conversationUi.update(activeConversationSession.id, {
        title: activeConversationSession.title, scope: activeConversationSession.scope,
        summary: proposal.summary, resolvedTopics: activeConversationSession.resolvedTopics,
        pendingTopics: activeConversationSession.pendingTopics,
        ...(activeConversationSession.tripId ? { tripId: activeConversationSession.tripId } : {}),
      }).then((saved) => { activeConversationSession = saved; }).catch(() => undefined);
      const currentPlan = loadTripPlan(localStorage, activeConversationSession.id);
      if (currentPlan) {
        contextWorkspaceController.show("trip-plan", {
          kind: "trip-plan",
          id: currentPlan.id,
        });
      }
    },
    onTripUpdateProposal: (proposal) => {
      if (!tripWorkspaceController.current()) return;
      try { tripWorkspaceController.preview(proposal); }
      catch { tripWorkspace.report("変更案を現在の旅程に適用できません。会話で確認し直してください。"); }
    },
    onChecklistProposal: (proposal) => {
      try { tripWorkspaceController.checklist.preview(proposal); }
      catch { tripWorkspace.report("準備リストの追加案を表示できません。最新のリストを確認してください。"); }
    },
  },
  (prompt, preferences, conversation, onResponseMetadata) =>
    handleAiGuidePrompt(
      prompt,
      preferences,
      conversation,
      onResponseMetadata,
    ),
);
const tripWorkspace = configureTripWorkspace({
  app, chat: aiGuidePanel, messages: aiGuideMessages, input: aiGuideInput,
  legacyPanel: tripPlanPanel, legacyToggle: tripPlanToggle, controller: tripWorkspaceController,
  showContext: (view) => contextWorkspaceController.show(view), returnToConversation,
  showMap: focusMapWorkspace, ask: (prompt) => aiGuideController.ask(prompt), nextItemId: () => crypto.randomUUID(),
});
const activateConversation = async (sessionId: string) => {
  const session = conversationUi.selectLocal(sessionId);
  if (!session) return;
  returnToConversation(); mapPlaceExplorerController?.clear(); activeConversationSession = session;
  serverAgentSession?.contextChanged(); syncServerTripSource(session);
  tripWorkspaceController.activateSession(session.id); contextWorkspaceController.activateSession(session.id);
  await conversationUi.loadHistory(session.id);
  if (conversationUi.active()?.id === session.id) aiGuideController.switchSession(session.id);
};
const createAndActivateConversation = async () => {
  if (!isSignedIn()) throw new Error("Authentication required");
  const session = await conversationUi.create();
  await activateConversation(session.id);
  return session;
};
const startNewConsultation = async (prompt: string) => {
  await createAndActivateConversation();
  aiGuideController.ask(prompt);
};
railNewConversation.addEventListener("click", () => {
  void createAndActivateConversation().catch(() => aiGuideController.notify("相談を始めるにはログインしてください。"));
});
let initialAuthenticationNotification = true;
let authenticationGeneration = 0;
currentAuthentication().subscribe(() => {
  if (initialAuthenticationNotification) { initialAuthenticationNotification = false; return; }
  const generation = ++authenticationGeneration;
  conversationUi.clear(); profileUi.clear(); activeConversationSession = unsignedConversation;
  aiGuideController.switchSession(unsignedConversation.id);
  tripWorkspaceController.activateSession(unsignedConversation.id);
  contextWorkspaceController.activateSession(unsignedConversation.id);
  if (!isSignedIn()) return;
  void Promise.all([conversationUi.hydrate(), profileUi.hydrate()]).then(async ([session]) => {
    if (generation !== authenticationGeneration) return;
    const selected = session ?? await conversationUi.create();
    if (generation !== authenticationGeneration) return;
    await activateConversation(selected.id);
  }).catch(() => undefined);
});
configureConversationHistoryPanel({
  newConversation,
  toggle: conversationHistoryToggle,
  dialog: conversationHistoryDialog,
  close: closeConversationHistory,
  list: conversationHistoryList,
  empty: conversationHistoryEmpty,
  storage: localStorage,
  repository: conversationUi,
  onSessionSelected: activateConversation,
});
configureApplicationSettingsPanel(document, {
  travelProfileToggle,
  transferPace: journeyTransferPace,
  rankingPreference: journeyRankingPreference,
  conversationHistoryDialog,
  accommodationProviderAttribution: accommodationProviderAttributionFromEnvironment(import.meta.env),
});
configureNotificationCenter({ root: document.body,
  buttons: [document.getElementById("rail-notifications")!, document.getElementById("sidebar-notifications")!],
  client: new HttpNotificationClient(), async navigate(tripId, itemId) {
    const trip = await serverTripClient.get(tripId); if (!trip) throw new Error("Trip unavailable");
    // Explicit navigation creates/reuses a reference, never a Trip or a second local Trip writer.
    const existing = conversationUi.list().find((session) => session.tripId === tripId);
    const session = existing ?? await conversationUi.create({ title: trip.title, tripId });
    await activateConversation(session.id);
    const source = tripWorkspaceController.source(); await source?.retry?.();
    if (tripWorkspaceController.current()?.id !== tripId) throw new Error("Trip unavailable");
    if (itemId && tripWorkspaceController.current()!.items.some((item) => item.id === itemId)) tripWorkspaceController.focus(itemId);
    returnToConversation(); if (mobileChatShell.matches && conversationHistoryDialog.open) conversationHistoryDialog.close();
    tripWorkspace.show("trip");
  } });
const sharingButton = document.createElement("button"); sharingButton.type = "button"; sharingButton.textContent = "旅程の共有";
document.getElementById("sidebar-notifications")?.after(sharingButton);
configureTripSharing({ root: document.body, button: sharingButton, client: new HttpTripSharingClient(), initialLink: initialShareLink,
  current: () => { const trip = tripWorkspaceController.current(); return trip ? { tripId: trip.id, role: tripWorkspaceController.source()?.getRole?.() } : undefined; },
  parseLink: parseTripShareLink, makeLink: (link) => makeTripShareLink(window.location.href, link),
  async navigate(tripId) {
    const trip = await serverTripClient.get(tripId); if (!trip) throw new Error("Trip unavailable");
    // A new personal conversation, never the owner's Conversation or Trace.
    const session = await conversationUi.create({ title: trip.title, tripId });
    await activateConversation(session.id);
    await tripWorkspaceController.source()?.retry?.();
    if (tripWorkspaceController.current()?.id !== tripId) throw new Error("Trip unavailable");
    returnToConversation(); tripWorkspace.show("trip");
  } });
aiGuideController.open();
applyContextWorkspaceState();
configureTravelProfile(document, profileUi, () => aiGuideController.open());
if (import.meta.env.DEV && new URLSearchParams(window.location.search).get("trip-workspace-preview") === "1") {
  if (!token) mapTools.hidden = true;
  loadingScreen.complete();
  document.querySelector<HTMLDialogElement>("#travel-profile-dialog")?.close();
  void import("../dev/trip-workspace-preview").then(({ tripWorkspacePreviewSource }) => {
    tripWorkspaceController.attach(activeConversationSession.id, tripWorkspacePreviewSource());
    tripWorkspace.show("trip");
  });
}
if (tripPreviewEnabled) {
  loadingScreen.complete();
  document.querySelector<HTMLDialogElement>("#travel-profile-dialog")?.close();
  void import("../dev/trip-plan-preview").then(({ tripPlanPreview }) =>
    tripPlanController.showPreview(tripPlanPreview));
}

const initialDateTime = new Date();
handleAiGuidePrompt = async (prompt) => {
  if (consultationTransportMode === "server") return serverAgentSession!.start(prompt).send();
  throw new Error("相談機能は現在利用できません。しばらくしてから再度お試しください。");
};

resolveAiGuidePromptHandler(handleAiGuidePrompt);
let displayedServiceDateStart = operatingServiceDateStart(initialDateTime);
const initialRouteTime = currentRouteTime(initialDateTime);
displayTime.value = String(initialRouteTime);
renderDisplayDateTime(dateTimeDisplayElements, initialDateTime);

let mapStarted = false;
const homePreview = import.meta.env.DEV ? new URLSearchParams(window.location.search).get("home-preview") : null;
startMap = () => {
  if (mapStarted) return;
  mapStarted = true;
  try { initializeMap(); }
  catch { status.hidden = false; status.textContent = "地図を起動できませんでした。相談は引き続き利用できます。"; }
};
primaryShell = configureAiFirstShell(document, app, {
  read: () => {
    const source = tripWorkspaceController.source(), trip = tripWorkspaceController.current();
    const load = tripWorkspaceController.loadState();
    return {
      state: homePreview === "loading" ? "loading" : homePreview === "error" ? "unavailable" : homePreview === "empty" ? "available"
        : !source ? "unauthenticated" : load === "loaded" ? "available" : load === "loading" ? "loading" : "unavailable",
      trips: trip ? [trip] : [], readiness: tripWorkspaceController.readiness(),
      candidates: tripWorkspaceController.candidates().map(({ candidate, assessment }) => ({
        id: candidate.id, title: candidate.experiences[0]?.name ?? candidate.accommodations[0]?.name ?? "移動の候補", assessment,
      })),
      preview: !!homePreview || (import.meta.env.DEV && new URLSearchParams(window.location.search).get("trip-workspace-preview") === "1"),
    };
  },
  profile: () => profileUi.current()?.profile, subscribe: (listener) => {
    const left = tripWorkspaceController.subscribe(listener), right = profileUi.subscribe(listener);
    return () => { left(); right(); };
  },
  retry: async () => { await tripWorkspaceController.source()?.retry?.(); },
  newConsultation: (prompt) => { void startNewConsultation(prompt).catch(() => aiGuideController.notify("相談を始めるにはログインしてください。")); },
  openChat: () => { aiGuideController.open(); if (tripWorkspaceController.current()) tripWorkspace.show("chat"); delete app.dataset.mapFocusMode; },
  openTrip: (id) => { if (tripWorkspaceController.current()?.id === id) tripWorkspace.show("trip"); },
  consultTrip: (id) => { if (tripWorkspaceController.current()?.id !== id) throw new Error("Trip reference mismatch"); tripWorkspace.show("chat"); },
  openProfile: () => travelProfileToggle.click(),
  openMap: (mode) => { startMap(); selectSidebarMapMode(mode === "simulation" ? "date-time" : "realtime"); },
  openHistory: () => conversationHistoryToggle.click(),
  openSettings: () => document.getElementById("sidebar-account-settings")?.click(),
  openNotifications: () => document.getElementById("sidebar-notifications")?.click(),
  now: () => new Date(),
});
loadingScreen.complete();
configureConsultationScreen(aiGuidePanel, aiGuideMessages, aiGuideForm, aiGuideInput, {
  read: () => ({ sessionId: tripWorkspaceController.sessionId(), trip: tripWorkspaceController.current(),
    unavailable: tripWorkspaceController.blocksLegacy() && !tripWorkspaceController.current(),
    viewer: tripWorkspaceController.source()?.getRole?.() === "viewer" }),
  profile: () => profileUi.current()?.profile, subscribe: (listener) => {
    const left = tripWorkspaceController.subscribe(listener), right = profileUi.subscribe(listener);
    return () => { left(); right(); };
  },
  preview: (proposal) => { tripWorkspaceController.preview(proposal); tripWorkspace.show("trip"); },
  showTrip: () => { const trip = tripWorkspaceController.current(); if (trip) { window.history.pushState({ tripId: trip.id }, "", "#trip"); window.dispatchEvent(new Event("popstate")); } },
  newConversation: () => { void createAndActivateConversation().then(() => aiGuideController.open()).catch(() => aiGuideController.notify("相談を始めるにはログインしてください。")); },
});
if (import.meta.env.DEV && homePreview === "data") {
  void import("../dev/home-preview").then(({ homePreviewSource }) => tripWorkspaceController.attach(activeConversationSession.id, homePreviewSource()));
}

function initializeMap() {
if (!token) {
  const missingTokenMessage =
    "Mapbox公開トークンがありません。.env.localにVITE_MAPBOX_ACCESS_TOKENを設定してください。";
  status.textContent = missingTokenMessage;
  loadingScreen.fail(missingTokenMessage);
} else {
  mapboxgl.accessToken = token;

  const map = new mapboxgl.Map({
    container: "map",
    style: "mapbox://styles/mapbox/standard",
    config: {
      basemap: {
        // 地図を抑えた背景へ寄せ、半透明の操作面と路線色を主役にする。
        theme: "faded",
        show3dObjects: true,
        showPointOfInterestLabels: false,
        showPlaceLabels: false,
        showRoadLabels: false,
        showTransitLabels: false,
        showLandmarkIcons: true,
        showLandmarkIconLabels: true,
      },
    },
    language: "ja",
    center: [135.4959, 34.7025],
    zoom: 15.5,
    // 日本列島を広く見渡せる一方、地球儀へ遷移して3D表示が浮いて見える縮尺は避ける。
    minZoom: 5.5,
    pitch: 62,
    bearing: -18,
    antialias: true,
  });
  resizeContextMap = () => map.resize();
  groundAccessLayer = createGroundAccessLayer(map);
  verifiedPlaceLayer = createVerifiedPlaceLayer(map, (place) =>
    mapPlaceExplorerController?.select(place.providerPlaceId, true), () => placeCameraOffset(
      map.getContainer().getBoundingClientRect(),
      [mapPlaceExplorer, mapPlaceDetail].filter((panel) => !panel.hidden).map((panel) => panel.getBoundingClientRect()),
    ));
  mapPlaceExplorerController = configureMapPlaceExplorer({
    panel: mapPlaceExplorer,
    list: mapPlaceExplorerList,
    close: closeMapPlaceExplorer,
    detail: mapPlaceDetail,
    detailContent: mapPlaceDetailContent,
    closeDetail: closeMapPlaceDetail,
    focusPlace: (providerPlaceId) => verifiedPlaceLayer?.focus(providerPlaceId),
    loadDetail: async (candidate) => {
      if (candidate.kind !== "place") return candidate;
      const response = await researchPlaceDetail({
        query: candidate.name,
        targetRef: candidate.value.sources?.find(source => source.role === "identity")
          ? { provider: candidate.value.sources.find(source => source.role === "identity")!.provider, providerPlaceId: candidate.id }
          : undefined,
        latitude: candidate.latitude,
        longitude: candidate.longitude,
      });
      const detail = response.result.status === "available"
        ? response.result.data?.places[0]
        : undefined;
      return detail ? mergeMapPlaceDetailCandidate(candidate, detail) : candidate;
    },
    choose: (candidate) => {
      if (candidate.kind === "accommodation") {
        if (tripWorkspaceController.blocksLegacy()) {
          closeMapPlaceDetail.click();
          tripWorkspace.show("chat");
          aiGuideController.ask(`${candidate.name}を宿泊候補として相談したい（まだ採用していません）`);
          return;
        }
        tripPlanController.selectAccommodation(candidate.value);
        contextWorkspaceController.show("trip-plan");
        return;
      }
      closeMapPlaceDetail.click();
      aiGuideController.ask(candidate.kind === "restaurant"
        ? `${candidate.name}を食事候補として旅程に入れたい`
        : `${candidate.name}を軸に旅程を考えたい`);
      returnToConversation();
    },
    clearPlaces: () => {
      pendingMapCandidates = [];
      verifiedPlaceLayer?.clear();
    },
  });
  if (pendingMapCandidates.length > 0) {
    verifiedPlaceLayer.show(pendingMapCandidates.map(mapCandidateAsPlaceMedia));
    mapPlaceExplorerController.show(pendingMapCandidates);
  }

  map.addControl(new mapboxgl.NavigationControl({ visualizePitch: true }));
  const geolocateControl = new mapboxgl.GeolocateControl({
    positionOptions: { enableHighAccuracy: true },
    fitBoundsOptions: { maxZoom: 16 },
    trackUserLocation: false,
    showAccuracyCircle: true,
    showUserHeading: true,
  });
  map.addControl(geolocateControl);
  const geolocateButton = document.querySelector<HTMLButtonElement>(
    ".mapboxgl-ctrl-geolocate",
  );
  if (geolocateButton) {
    geolocateButton.ariaLabel = "現在地へ移動";
    geolocateButton.title = "現在地へ移動";
  }
  map.addControl(
    {
      onAdd: () => mapTools,
      onRemove: () => mapTools.remove(),
    },
    "top-right",
  );
  map.addControl(
    {
      onAdd: () => {
        const control = document.createElement("div");
        control.className = "ai-guide-control mapboxgl-ctrl";
        control.append(aiGuideToggle);
        return control;
      },
      onRemove: () => aiGuideToggle.remove(),
    },
    "top-right",
  );

  let disposeDataUpdates = () => undefined;
  map.on("style.load", async () => {
    disposeDataUpdates();
    disposeDataUpdates = () => undefined;
    status.hidden = false;
    loadingScreen.setMessage("地図の表示を整えています。");
    map.setConfigProperty("basemap", "show3dObjects", true);
    map.setConfigProperty("basemap", "showPointOfInterestLabels", false);
    map.setConfigProperty("basemap", "showPlaceLabels", false);
    map.setConfigProperty("basemap", "showRoadLabels", false);
    // Mapbox Standardでは空港だけを除外できないため、空港を含む交通ラベル群を隠す。
    // TransitForgeが描画する路線・列車・詳細表示には影響しない。
    map.setConfigProperty("basemap", "showTransitLabels", false);
    map.setConfigProperty("basemap", "showLandmarkIcons", true);
    map.setConfigProperty("basemap", "showLandmarkIconLabels", true);
    configureLandmarkJourneyInteraction(map, (landmark) => {
      const landmarkCoordinate: [number, number] | undefined = landmark.longitude !== undefined &&
        landmark.latitude !== undefined
        ? [landmark.longitude, landmark.latitude]
        : undefined;
      if (landmarkCoordinate) {
        map.easeTo({
          center: landmarkCoordinate,
          zoom: Math.max(map.getZoom(), 17.6),
          pitch: 68,
          bearing: -24,
          duration: 850,
        });
      }
      mapPlaceExplorerController?.showPending({
        name: landmark.name,
        choose: () => {
          closeMapPlaceDetail.click();
          aiGuideController.ask(`${landmark.name}を軸に旅程を考えたい`);
          returnToConversation();
        },
        load: async () => {
          const response = await researchPlaceDetail({
            query: landmark.name,
            ...(landmark.providerPlaceId ? { targetRef: { provider: "mapbox", providerPlaceId: landmark.providerPlaceId } } : {}),
            ...(landmarkCoordinate ? { latitude: landmarkCoordinate[1], longitude: landmarkCoordinate[0] } : {}),
          });
          return response.result.status === "available" ? mapPlaceCandidates(response.result.data?.places ?? []) : [];
        },
        onLoaded: (candidates) => {
          pendingMapCandidates = [...candidates];
          verifiedPlaceLayer?.show(candidates.map(mapCandidateAsPlaceMedia));
          verifiedPlaceLayer?.focus(candidates[0]!.id);
          contextWorkspaceController.show("map", { kind: "place", id: candidates[0]!.id });
        },
      });
    });
    let applyWeatherToTrains: (mode: WeatherMode) => void = () => undefined;
    let activeWeatherMode: WeatherMode = "clear";
    const applyAutomaticWeather = (mode: WeatherMode) => {
      activeWeatherMode = mode;
      applyWeather(map, mode);
      applyWeatherToTrains(mode);
    };
    applyAutomaticWeather("clear");
    runtimeMonitor.start();
    let activeLightPreset: LightPreset | undefined;

    try {
      status.textContent = "全経路を読み込んでいます。";
      loadingScreen.setMessage("鉄道路線を読み込んでいます。");
      const routeLoadStartedAt = performance.now();
      const catalog = await loadPathCatalog();
      metrics.recordRouteLoad(performance.now() - routeLoadStartedAt);
      runtimeMonitor.log();

      status.textContent = "列車を読み込んでいます。";
      loadingScreen.setMessage("列車と時刻表を読み込んでいます。");
      const trainLoadStartedAt = performance.now();
      const trainIndex = await loadTrainIndex();
      const stationLineCatalog =
        trainIndex.station_line_catalog ?? emptyStationLineCatalog();
      if (!trainIndex.station_line_catalog) {
        console.warn(
          "[Raiquora] train_indexに駅・路線カタログがないため、路線色をグレーで表示します。",
        );
      }
      const geometry = new PathGeometryIndex(catalog.paths);
      const lineColorIndex = new TrainLineColorIndex(stationLineCatalog);
      const colorsByServiceUid = new Map(
        trainIndex.trains.map((train) => [
          train.service_uid,
          lineColorIndex.colorFor(train).color,
        ]),
      );
      const destinationCoordinatesByServiceUid = new Map(
        trainIndex.trains.flatMap((train) => {
          const coordinate = destinationCoordinateForTrain(train, geometry);
          return coordinate ? [[train.service_uid, coordinate] as const] : [];
        }),
      );
      const lineColorsByPathId = dominantLineColorsByPathId(
        trainIndex.trains,
        colorsByServiceUid,
      );
      const routeCollections = toRouteFeatureCollections(
        catalog,
        64,
        lineColorsByPathId,
      );
      metrics.recordTrainLoad(performance.now() - trainLoadStartedAt);
      runtimeMonitor.log();
      console.debug("[Raiquora] viewer catalog", {
        routes: catalog.paths.length,
        trains: trainIndex.trains.length,
      });
      for (const [index, routes] of routeCollections.entries()) {
        const sourceId = `routes-${index}`;
        map.addSource(sourceId, { type: "geojson", data: routes });
        map.addLayer({
          id: sourceId,
          type: "line",
          source: sourceId,
          slot: "middle",
          paint: {
            "line-color": [
              "coalesce",
              ["get", "line_color"],
              "#8f9aa6",
            ],
            "line-width": 1.5,
            "line-opacity": 0.48,
          },
        });

        status.textContent = `全経路を読み込んでいます (${index + 1}/${routeCollections.length})。`;
        loadingScreen.setMessage(
          `鉄道路線を描画しています (${index + 1}/${routeCollections.length})。`,
        );
        await nextBrowserFrame();
      }

      const maximumRouteTime = maximumRouteTimeFor(trainIndex.trains);
      displayTime.max = String(Math.ceil(maximumRouteTime / 60) * 60);
      const formationLinks = trainFormationLinks(trainIndex.trains);

        loadingScreen.setMessage("列車の初期位置を準備しています。");
        const threeTrainLayer = new MapboxThreeTrainLayer(
          colorsByServiceUid,
          destinationCoordinatesByServiceUid,
          formationLinks,
        );
        applyWeatherToTrains = (mode) => {
          threeTrainLayer.setCloudyAtmosphereEnabled(mode !== "clear");
        };
        applyWeatherToTrains(activeWeatherMode);
        map.addLayer(threeTrainLayer);
        configureDestinationArcs(
          threeTrainLayer,
          destinationArcsToggle,
        );
        const congestionUpdates = configureTrainCongestionUpdates(
          threeTrainLayer,
          congestionToggle,
          realtimeUpdateDependencies,
        );
        map.addSource("train-hit-targets", { type: "geojson", data: emptyFeatureCollection() });
        map.addLayer({
          id: "train-hit-targets",
          type: "circle",
          source: "train-hit-targets",
          slot: "top",
          paint: {
            // タッチ操作でも選びやすい44px相当の当たり判定にする。
            "circle-radius": 22,
            "circle-opacity": 0,
            "circle-stroke-opacity": 0,
          },
        });
        const trainFocusReturnContext = new TrainFocusReturnContextSession();
        const selection = configureTrainSelection(
          map,
          trainIndex.trains,
          threeTrainLayer,
          colorsByServiceUid,
          formationLinks,
          {
            details: trainDetails,
            close: closeTrainDetails,
            title: selectedTrainTitle,
            stopping: selectedTrainStopping,
            delay: selectedTrainDelay,
            stops: selectedTrainStops,
            coupledTabs: trainDetailTabs,
            onFocus: (serviceUid) => {
              trainFocusReturnContext.start(
                contextWorkspaceController.current(),
                mobileContextNavigation.isOpen(),
              );
              const focused = contextWorkspaceController.show("journey-details", {
                kind: "journey",
                id: serviceUid,
              });
              if (focused && mobileChatShell.matches) {
                app.dataset.mobileContextOpen = "true";
                app.dataset.mobileContextView = "journey-details";
              }
            },
            onEndFocus: () => {
              const returnContext = trainFocusReturnContext.end();
              if (!returnContext) return;
              const { workspace, mobileContextOpen } = returnContext;
              contextWorkspaceController.show(workspace.view, workspace.entity);
              if (!mobileChatShell.matches) return;
              if (mobileContextOpen) {
                mobileContextNavigation.open(workspace.view);
              } else if (mobileContextNavigation.isOpen()) {
                mobileContextNavigation.close();
              }
            },
          },
        );
        let displayedPositions: TrainPosition[] = [];
        let latestDelaySnapshot: TrainDelaySnapshot | undefined;
        let digitalTwinModeRequested = true;
        const localWeatherLayer = createLocalWeatherLayer(map, applyAutomaticWeather);
        const localizedWeatherSearch = weatherPreviewEnabled
          ? (await import("../dev/weather-grid-preview")).searchWeatherGridPreview
          : searchWeatherGrid;
        const localWeatherUpdates = configureLocalWeatherUpdates(
          map,
          localWeatherLayer,
          localizedWeatherSearch,
          () => digitalTwinModeRequested
            ? undefined
            : dateForOperatingRouteTime(
                displayedServiceDateStart,
                Number(displayTime.value),
              ),
        );
        let playbackControls: PlaybackUiController | undefined;
        let aliasedOperationsSource: ReadonlyMap<string, TrainOperation> | undefined;
        let aliasedOperations: ReadonlyMap<string, TrainOperation> | undefined;
        let appliedOperations:
          | ReadonlyMap<string, TrainOperation>
          | undefined
          | null = null;
        let displayTrains = trainIndex.trains;
        let displayDelays: ReadonlyMap<string, number> = new Map();
        let displayDestinationChanges: ReadonlySet<string> = new Set();
        let displayLongTimeStoppingServiceUids: ReadonlySet<string> = new Set();

        const applyOperationMode = (displayedAt: Date) => {
          const now = new Date();
          const realtimeOperations = operationsForDisplay(
            latestDelaySnapshot,
            displayedAt,
            now,
            false,
          );
          const modeState = resolveViewerDisplayMode(
            realtimeOperations !== undefined,
            digitalTwinModeRequested,
          );
          const sourceOperations = modeState.mode === "digital-twin"
            ? realtimeOperations
            : undefined;
          if (sourceOperations !== aliasedOperationsSource) {
            aliasedOperationsSource = sourceOperations;
            const trainNumberOperations = operationsWithTimetableTrainNumberAliases(
              trainIndex.trains,
              sourceOperations,
            );
            aliasedOperations = operationsWithCoupledTrainOperations(
              trainIndex.trains,
              trainNumberOperations,
              formationLinks,
            );
          }
          const operations = aliasedOperations;
          renderDisplayMode(
            {
              app,
              dateTimeInput,
              currentTimeButton,
              toggle: digitalTwinModeToggle,
              realtimeModeButtons: [sidebarRealtimeMap, railRealtimeMap],
              dateTimeModeButtons: [sidebarDateTimeMode, railDateTimeMode],
              simulationOnlyControls: [
                digitalTwinModeToggle,
                currentTimeButton,
                playToggle,
                playbackSpeedMenuToggle.closest<HTMLElement>(".playback-speed-menu") ?? playbackSpeedMenuToggle,
                destinationArcsToggle,
              ],
              realtimeOnlyControls: [congestionToggle],
            },
            realtimeOperations !== undefined,
            modeState.mode,
          );
          congestionUpdates.setAvailable(modeState.congestionEnabled);
          playbackControls?.setDigitalTwinMode(
            !modeState.simulationControlsEnabled,
          );
          if (operations === appliedOperations) {
            return;
          }
          appliedOperations = operations;
          const destinationChanges = destinationChangedServiceUids(
            trainIndex.trains,
            operations,
          );
          displayDestinationChanges = destinationChanges;
          displayTrains = trainsForOperations(
            trainIndex.trains,
            operations,
            destinationChanges,
          );
          displayDelays = delayByTrainNumber(operations);
          displayLongTimeStoppingServiceUids = new Set(
            displayTrains.flatMap((train) =>
              operations?.get(train.train_no)?.longTimeStopping === true
                ? [train.service_uid]
                : [],
            ),
          );
          const operationDestinationCoordinates = new Map(
            displayTrains.flatMap((train) => {
              const coordinate = destinationCoordinateForTrain(train, geometry);
              return coordinate
                ? [[train.service_uid, coordinate] as const]
                : [];
            }),
          );
          threeTrainLayer.setDelayByTrainNumber(displayDelays);
          threeTrainLayer.setDestinationChanges(
            destinationChanges,
            operationDestinationCoordinates,
          );
          selection.updateOperations(operations, destinationChanges);
          console.info("[Raiquora] 列車表示モード", {
            mode: operations ? "digital-twin" : "simulation",
            timetableTrains: trainIndex.trains.length,
            displayedTrains: displayTrains.length,
            unobservedTimetableEntries: operations
              ? trainIndex.trains.length - displayTrains.length
              : 0,
            delayedTrains: [...displayDelays.values()].filter(
              (delay) => delay > 0,
            ).length,
            destinationChangedTrains: destinationChanges.size,
            longTimeStoppingTrains: displayLongTimeStoppingServiceUids.size,
            collectedAt: latestDelaySnapshot?.collectedAt,
          });
        };

        const updateTrains = (routeTime = Number(displayTime.value)) => {
          const lightPreset = lightPresetForRouteTime(routeTime);
          if (lightPreset !== activeLightPreset) {
            map.setConfigProperty("basemap", "lightPreset", lightPreset);
            activeLightPreset = lightPreset;
          }
          const updateStartedAt = performance.now();
          const displayedAt = dateForOperatingRouteTime(
            displayedServiceDateStart,
            routeTime,
          );
          applyOperationMode(displayedAt);
          const calculatedPositions = activeTrainPositions(
            displayTrains,
            geometry,
            routeTime,
            displayDelays,
            displayDestinationChanges,
          );
          const positions = freezeLongTimeStoppingPositions(
            calculatedPositions,
            displayedPositions,
            displayLongTimeStoppingServiceUids,
            displayDestinationChanges,
          );
          displayedPositions = positions;
          threeTrainLayer.setPositions(positions);
          selection.updateTracking(positions);
          const hitSource = map.getSource("train-hit-targets") as mapboxgl.GeoJSONSource;
          const trainLayouts = coupledTrainLayouts(positions, formationLinks);
          hitSource.setData({
            type: "FeatureCollection",
            features: trainHitTargetsFor(trainLayouts).map((target) => ({
              type: "Feature" as const,
              properties: { service_uid: target.serviceUid },
              geometry: { type: "Point" as const, coordinates: target.coordinate },
            })),
          });
          renderDisplayDateTime(dateTimeDisplayElements, displayedAt);
          status.hidden = true;
          metrics.recordPositionUpdate(performance.now() - updateStartedAt, positions.length);
          runtimeMonitor.log();
        };

        const disposeDelayUpdates = configureTrainDelayUpdates((snapshot) => {
          latestDelaySnapshot = snapshot;
          updateTrains();
        }, realtimeUpdateDependencies);
        disposeDataUpdates = () => {
          congestionUpdates.dispose();
          disposeDelayUpdates();
          localWeatherUpdates.dispose();
        };

        displayTime.addEventListener("input", () => {
          updateTrains();
          localWeatherUpdates.scheduleRefresh();
        });
        digitalTwinModeToggle.addEventListener("click", () => {
          if (digitalTwinModeToggle.disabled) {
            return;
          }
          digitalTwinModeRequested = digitalTwinModeToggle.ariaPressed !== "true";
          updateTrains();
          localWeatherUpdates.scheduleRefresh();
        });
        configureDateTimeInput(
          dateTimeInput,
          () =>
            dateForOperatingRouteTime(
              displayedServiceDateStart,
              Number(displayTime.value),
            ),
          (date) => {
            displayedServiceDateStart = operatingServiceDateStart(date);
            displayTime.value = String(currentRouteTime(date));
            displayTime.dispatchEvent(new Event("input", { bubbles: true }));
          },
        );
        displayTime.disabled = false;
        currentTimeButton.disabled = false;
        const playbackSpeedControls = configurePlaybackSpeed(
          playbackSpeed,
          playbackSpeedButtons,
          playbackSpeedMenuToggle,
          playbackSpeedOptions,
        );
        playbackControls = configurePlayback(
          { displayTime, playToggle, currentTimeButton, playbackSpeed },
          updateTrains,
          maximumRouteTime,
          (date) => {
            displayedServiceDateStart = operatingServiceDateStart(date);
          },
          () => {
            displayedServiceDateStart = stepDisplayDateTime(
              displayedServiceDateStart,
              "day",
              1,
            );
          },
          playbackSpeedControls,
          browserDigitalTwinClockEnvironment(),
        );
        applySidebarMapMode = (mode) => {
          if (mode === "realtime") {
            const now = new Date();
            digitalTwinModeRequested = true;
            displayedServiceDateStart = operatingServiceDateStart(now);
            displayTime.value = String(currentRouteTime(now));
            displayTime.dispatchEvent(new Event("input", { bubbles: true }));
            return;
          }
          digitalTwinModeRequested = false;
          updateTrains();
          requestAnimationFrame(() => {
            dateTimeInput.closest<HTMLElement>(".date-time-display")?.click();
          });
        };
        if (pendingSidebarMapMode) {
          const pendingMode = pendingSidebarMapMode;
          pendingSidebarMapMode = undefined;
          applySidebarMapMode(pendingMode);
        }
        updateTrains();
        await nextBrowserFrame();
        resolveAiGuidePromptHandler(handleAiGuidePrompt);
        loadingScreen.complete();
    } catch (error) {
      const message = error instanceof Error ? error.message : "不明なエラーです。";
      status.hidden = false;
      status.textContent = `入力を読み込めませんでした: ${message}`;
      loadingScreen.fail(`入力を読み込めませんでした: ${message}`);
    }
  });

  map.on("error", (event) => {
    status.hidden = false;
    status.textContent = `地図の読み込みに失敗しました: ${event.error.message}`;
    if (!loadingScreen.isComplete()) {
      loadingScreen.fail(
        `地図の読み込みに失敗しました: ${event.error.message}`,
      );
    }
  });
}

function emptyFeatureCollection() {
  return { type: "FeatureCollection" as const, features: [] };
}

}
}
