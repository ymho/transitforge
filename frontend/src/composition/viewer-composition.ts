import type { TripRequest } from "@raiquora/trip/trip-request";
import { createTripConsultationNavigation } from "../usecases/trip-plan/trip-consultation-navigation";
import { currentAuthentication } from "./auth-composition";
import { createConversationStreamSession } from "../adapters/http/agent-stream/session";

import { placeCameraOffset } from "../presentation/place-explorer/place-camera-offset";
import { accommodationProviderAttributionFromEnvironment } from "../adapters/browser/accommodation-provider-attribution";
import { browserDigitalTwinClockEnvironment } from "../adapters/browser/digital-twin-clock-environment";
import { browserPollingEnvironment } from "../adapters/browser/polling-controller";
import { createRuntimeMonitor, nextBrowserFrame } from "../adapters/browser/runtime-monitor";
import { applyWeather } from "../adapters/mapbox/map-weather";
import { createLocalWeatherLayer } from "../adapters/mapbox/local-weather-layer";
import { createGroundAccessLayer, type GroundAccessLayerController } from "../adapters/mapbox/ground-access-layer";
import type { VerifiedPlaceLayerController } from "../adapters/mapbox/place-media-layer";
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
import { dateForOperatingRouteTime, operatingServiceDateStart } from "../domain/display-date-time";
import { createDigitalTwinClockSynchronizer } from "../domain/digital-twin-clock";
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
import { configureSidebarMapModeSelection } from "../presentation/train-viewer/map-controls";
import { createLoadingScreen } from "../presentation/shared/loading-screen";
import {
  configureMapPlaceExplorer,
  type MapPlaceExplorerController,
} from "../presentation/place-explorer/map-place-explorer";
import { RuntimeMetrics } from "../observability/runtime-metrics";
import { configureTravelProfile } from "../presentation/concierge/travel-profile-panel";
import { HttpServerProfileClient } from "../adapters/http/server-profile-client";
import { ProfileUiController } from "../usecases/personal-state/profile-ui-controller";
import { HttpServerConversationClient } from "../adapters/http/server-conversation-client";
import { ConversationUiController } from "../usecases/personal-state/conversation-ui-controller";
import { configureApplicationSettingsPanel } from "../presentation/settings/application-settings-panel";
import { createTripWorkspaceController } from "../usecases/trip-plan/trip-workspace-controller";
import { createReferencedTripSource } from "../usecases/trip-plan/server-trip-workspace-source";
import { HttpServerTripClient } from "../adapters/http/server-trip-client";
import { createServerTripListSource } from "../usecases/trip-plan/server-trip-list-source";
import { createConversationDraftTrip } from "../usecases/trip-plan/create-conversation-draft-trip";
import { HttpNotificationClient } from "../adapters/http/notification-client";
import { configureNotificationCenter } from "../presentation/notifications/notification-center";
import { configureTripSharing } from "../presentation/trip-plan/trip-sharing-panel";
import "../presentation/trip-plan/trip-sharing-panel.css";
import { HttpTripSharingClient } from "../adapters/http/trip-sharing-client";
import { consumeTripShareLink, makeTripShareLink, parseTripShareLink } from "../adapters/browser/trip-share-link";
import { configureTripWorkspace } from "../presentation/trip-plan/trip-workspace";
import { projectTripPlaces } from "@raiquora/trip/trip-places";
import type { TripMapOverlay, TripMapPoint, TripMapRoute } from "../adapters/mapbox/trip-map-overlay";
import { projectTripRouteGeometry } from "../domain/trip-route-geometry";
import { HttpInTripContextClient } from "../adapters/http/in-trip-context-client";
import { BrowserContextWorkspaceRepository } from "../adapters/browser/context-workspace-repository";
import type { ConversationSession } from "../domain/conversation-session";
import { createContextWorkspaceController } from "../usecases/context-workspace/context-workspace-controller";
import { createMobileContextNavigation } from "../presentation/concierge/mobile-context-navigation";
import {
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
  loadingSteps,
  status,
  contextWorkspaceTabs,
  closeContextWorkspace,
  displayTime,
  mapTools,
  mapPlaceExplorer,
  mapPlaceExplorerList,
  closeMapPlaceExplorer,
  mapPlaceDetail,
  mapPlaceDetailContent,
  closeMapPlaceDetail,
  congestionToggle,
  aiGuidePanel,
  aiGuideToggle,
  closeAiGuide,
  aiGuideMessages,
  aiGuideForm,
  aiGuideInput,
  aiGuideSubmit,
  railNewConversation,
  railRealtimeMap,
  sidebarRealtimeMap,
  travelProfileToggle,
  aiGuideSuggestions,
  aiGuideContextChoices,
  journeySettingsToggle,
  journeySettingsPanel,
  journeyTransferPace,
  journeyRankingPreference,
  trainDetails,
  closeTrainDetails,
  selectedTrainTitle,
  selectedTrainDelay,
  selectedTrainStopping,
  selectedTrainStops,
  trainDetailTabs,
} = loadViewerElements(document);
const metrics = new RuntimeMetrics();
const runtimeMonitor = createRuntimeMonitor(metrics);

const loadingScreen = createLoadingScreen({
  app,
  screen: loadingScreenElement,
  message: loadingScreenMessage,
  retry: loadingScreenRetry,
  steps: loadingSteps,
});
loadingScreenRetry.addEventListener("click", () => window.location.reload());

let resolveAiGuidePromptHandler: (handler: AiGuidePromptHandler) => void = () => undefined;
const aiGuidePromptHandlerReady = new Promise<AiGuidePromptHandler>((resolve) => {
  resolveAiGuidePromptHandler = resolve;
});
let handleAiGuidePrompt: AiGuidePromptHandler = (...args) =>
  aiGuidePromptHandlerReady.then((handler) => handler(...args));
// Conversation persistence and consultation are server-owned.
const canUsePersonalState = () => currentAuthentication().getState().status === "signed-in";
const serverConversationClient = new HttpServerConversationClient();
const conversationUi = new ConversationUiController(serverConversationClient, canUsePersonalState);
const profileUi = new ProfileUiController(new HttpServerProfileClient(), canUsePersonalState);
const unsignedConversation: ConversationSession = {
  id: "ui-unauthenticated", title: "新しい会話", scope: "general", summary: "", resolvedTopics: [], pendingTopics: [],
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
};
let activeConversationSession = unsignedConversation;
const pendingConsultationKey = "raiquora:pending-consultation";
const isSignedIn = canUsePersonalState;
if (isSignedIn()) {
  try {
    activeConversationSession = (await conversationUi.hydrate()) ?? await conversationUi.create();
    await conversationUi.loadHistory(activeConversationSession.id);
    activeConversationSession = conversationUi.active() ?? activeConversationSession;
    await profileUi.hydrate();
  } catch { conversationUi.clear(); profileUi.clear(); }
}
let aiGuideController: ReturnType<typeof configureAiGuidePanel>;
let verifiedPlaceLayer: VerifiedPlaceLayerController | undefined;
let mapPlaceExplorerController: MapPlaceExplorerController | undefined;
let groundAccessLayer: GroundAccessLayerController | undefined;
let pendingMapCandidates: MapTravelCandidate[] = [];
let tripMapOverlay: TripMapOverlay | undefined;
let pendingTripMap: { key: string; points: TripMapPoint[]; routes: TripMapRoute[]; itemId?: string } | undefined;
let tripRouteGeometry: ((trip: import("@raiquora/trip/trip").Trip) => TripMapRoute[]) | undefined;
const weatherPreviewEnabled = import.meta.env.DEV &&
  new URLSearchParams(window.location.search).get("weather-preview") === "mixed";
const mobileChatShell = window.matchMedia("(max-width: 71.999rem)");
const contextWorkspaceController = createContextWorkspaceController(
  activeConversationSession.id,
  new BrowserContextWorkspaceRepository(localStorage),
);
const tripWorkspaceController = createTripWorkspaceController(activeConversationSession.id);
const serverAgentSession = createConversationStreamSession({
  auth: currentAuthentication(), references: () => ({ conversationId: activeConversationSession.id,
    tripId: tripWorkspaceController.current()?.id, tripRevision: tripWorkspaceController.current()?.revision,
    draftRequestVersion: conversationUi.draftRequestVersion(activeConversationSession.id),
    itemId: tripWorkspaceController.uiFocus()?.itemId }),
});
tripWorkspaceController.subscribe(() => {
  serverAgentSession.contextChanged();
  const trip = tripWorkspaceController.current();
  if (pendingTripMap && (!trip || pendingTripMap.key !== `${trip.id}:${trip.revision}`)) {
    pendingTripMap = undefined; tripMapOverlay?.clear();
  }
});
conversationUi.subscribe(() => serverAgentSession.contextChanged());

const serverTripClient = new HttpServerTripClient();
const inTripContextClient = new HttpInTripContextClient();
const pendingDraftTripIds = new Map<string, { id: string; now: string; request: TripRequest }>();
const serverTripList = createServerTripListSource(serverTripClient, canUsePersonalState);
if (isSignedIn()) void serverTripList.refresh();
const serverTripReferences = new Map<string, string>();
const syncServerTripSource = (session: typeof activeConversationSession) => {
  if (!session.tripId) return;
  const key = session.tripId;
  if (serverTripReferences.get(session.id) === key) return;
  serverTripReferences.set(session.id, key);
  const source = createReferencedTripSource(session, serverTripClient, {
    mutate: async (mutation) => { const result = await serverTripClient.mutate(mutation); void serverTripList.refresh(); return result; },
    newMutationId: () => crypto.randomUUID(),
    validateConfirmation: async (_trip, proposal) => {
      // Other patches require a trusted candidate/reservation confirmation adapter.
      if (proposal.patches.some((patch) => patch.type !== "request" && patch.type !== "title" && patch.type !== "cost_forecast" && patch.type !== "cost_override")) {
        throw new Error("予定の変更は、この画面からはまだ保存できません。条件・名称・費用の変更だけを確認してください。");
      }
    },
  });
  if (source) tripWorkspaceController.attach(session.id, source);
};
syncServerTripSource(activeConversationSession);
let resizeContextMap: () => void = () => undefined;
let primaryShell: ReturnType<typeof configureAiFirstShell> | undefined;
let startMap: () => Promise<void> = async () => undefined;
const scheduleContextMapResize = () => {
  requestAnimationFrame(() => resizeContextMap());
};
configureSidebarMapModeSelection({
  app,
  realtimeModeButtons: [sidebarRealtimeMap, railRealtimeMap],
});
const focusMapWorkspace = () => {
  if (app.dataset.primaryView !== "map") primaryShell?.showMap();
  void startMap();
  contextWorkspaceController.show("map");
  app.dataset.mapFocusMode = "true";
  if (mobileChatShell.matches) mobileContextNavigation.open("map");
  scheduleContextMapResize();
};
const focusTripMap = (itemId?: string) => {
  const trip = tripWorkspaceController.current();
  if (!trip) return;
  const points = projectTripPlaces(trip).visitedPlaces.flatMap((entry) => entry.place.coordinate ? [{
    itemId: entry.itemId, name: entry.place.name, longitude: entry.place.coordinate.longitude, latitude: entry.place.coordinate.latitude,
  }] : []);
  const routes = tripRouteGeometry?.(trip) ?? [];
  pendingTripMap = { key: `${trip.id}:${trip.revision}`, points, routes, ...(itemId ? { itemId } : {}) };
  focusMapWorkspace();
  if (!points.length && !routes.length) { tripWorkspace.report("保存済みの座標や確認できる鉄道経路がないため、地図へ表示できません。"); return; }
  tripMapOverlay?.show(pendingTripMap.key, points, routes, itemId);
};
const selectSidebarMapMode = () => {
  focusMapWorkspace();
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
  if (state.view === "map" && !trainDetails.hidden) closeTrainDetails.click();
  scheduleContextMapResize();
};
contextWorkspaceController.subscribe(applyContextWorkspaceState);
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
railRealtimeMap.addEventListener("click", selectSidebarMapMode);
sidebarRealtimeMap.addEventListener("click", selectSidebarMapMode);
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
      const conversationId = activeConversationSession.id;
      void conversationUi.rename(conversationId, prompt.slice(0, 32))
        .then((renamed) => { if (activeConversationSession.id === conversationId) activeConversationSession = renamed; })
        .catch(() => undefined);
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
    responseContextKey: () => JSON.stringify([serverAgentSession.contextVersion(), activeConversationSession.id, tripWorkspaceController.current()?.id, tripWorkspaceController.current()?.revision]),
    onTripCostProposal: (proposal) => {
      try { tripWorkspaceController.preview(proposal); tripWorkspace.show("trip"); }
      catch { aiGuideController.notify("旅程が変わったため費用案を適用できません。現在の旅程で再予測してください。"); }
    },
    onConsultationRequestProposal: (proposal) => {
      try { consultationScreen.previewConsultationProposal(proposal); }
      catch { aiGuideController.notify("相談の条件が変わったため、この案は適用できません。現在の条件で変更案を作り直してください。"); }
    },
    onTripUpdateProposal: (proposal) => {
      if (!tripWorkspaceController.current()) return;
      try { tripWorkspaceController.preview(proposal); tripWorkspace.show("trip"); }
      catch { tripWorkspace.report("変更案を現在の旅程に適用できません。会話で確認し直してください。"); }
    },
    onPlanAdoption: async (target) => {
      if (!serverTripClient.previewPlanAdoption || !serverTripClient.confirmPlanAdoption || activeConversationSession.id !== target.conversationId) throw new Error("Adoption unavailable");
      const preview = await serverTripClient.previewPlanAdoption(target);
      return { changes: preview.preview.changes, confirm: async () => {
        if (activeConversationSession.id !== target.conversationId) throw new Error("Conversation changed");
        await serverTripClient.confirmPlanAdoption!(target, preview.confirmationKey);
        await tripWorkspaceController.source()?.retry?.(); await serverTripList.refresh(); tripWorkspace.show("trip");
      } };
    },
    onChecklistProposal: (proposal) => {
      try { tripWorkspaceController.checklist.preview(proposal); }
      catch { tripWorkspace.report("準備リストの追加案を表示できません。最新のリストを確認してください。"); }
    },
  },
  (prompt, preferences, conversation, onResponseMetadata, options) =>
    handleAiGuidePrompt(
      prompt,
      preferences,
      conversation,
      onResponseMetadata,
      options,
    ),
);
const tripWorkspace = configureTripWorkspace({
  app, chat: aiGuidePanel, messages: aiGuideMessages, input: aiGuideInput,
  controller: tripWorkspaceController,
  showContext: (view) => contextWorkspaceController.show(view), returnToConversation,
  showMap: focusTripMap, loadInTripContext: (tripId) => inTripContextClient.read(tripId),
  ask: (prompt) => aiGuideController.ask(prompt), nextItemId: () => crypto.randomUUID(),
});
let canLeaveConditions = () => true;
const activateConversation = async (sessionId: string) => {
  if (activeConversationSession.id !== sessionId && !canLeaveConditions()) throw new Error("Navigation cancelled");
  const session = conversationUi.selectLocal(sessionId);
  if (!session) return;
  returnToConversation(); mapPlaceExplorerController?.clear(); activeConversationSession = session;
  serverAgentSession.contextChanged(); syncServerTripSource(session);
  tripWorkspaceController.activateSession(session.id); contextWorkspaceController.activateSession(session.id);
  aiGuideController.switchSession(session.id);
  aiGuideInput.disabled = true; aiGuideSubmit.disabled = true;
  await conversationUi.loadHistory(session.id);
  if (conversationUi.active()?.id === session.id) {
    activeConversationSession = conversationUi.active()!;
    syncServerTripSource(activeConversationSession);
    tripWorkspaceController.activateSession(session.id);
    aiGuideController.switchSession(session.id);
  }
};
const tripNavigation = createTripConsultationNavigation({
  getTrip: (id) => serverTripClient.get(id),
  findConversation: (id) => conversationUi.findForTrip(id),
  createConversation: (trip) => conversationUi.create({ title: trip.title, scope: "trip", tripId: trip.id }, false),
  activate: activateConversation,
  refresh: async () => { await tripWorkspaceController.source()?.retry?.(); },
  current: () => ({ conversationId: activeConversationSession.id, tripId: tripWorkspaceController.current()?.id }),
  show: (view) => { returnToConversation(); aiGuideController.open(); tripWorkspace.show(view); },
  sessionVersion: () => serverTripClient.sessionVersion(),
});
const createAndActivateConversation = async () => {
  if (!canLeaveConditions()) throw new Error("Navigation cancelled");
  const navigation = tripNavigation.cancel(), account = serverTripClient.sessionVersion();
  if (!isSignedIn()) throw new Error("Authentication required");
  const session = await conversationUi.create({}, false);
  if (navigation !== tripNavigation.version() || account !== serverTripClient.sessionVersion()) throw new Error("Navigation cancelled");
  await activateConversation(session.id);
  return session;
};
const startNewConsultation = async (prompt: string) => {
  if (!isSignedIn()) {
    try { sessionStorage.setItem(pendingConsultationKey, prompt.slice(0, 400)); } catch { /* Optional UI-only return draft. */ }
    aiGuideController.notify("相談を保存して続けるにはログインが必要です。ログイン画面へ移動します。");
    await currentAuthentication().login();
    return;
  }
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
  tripNavigation.cancel(); pendingDraftTripIds.clear(); serverTripReferences.clear();
  conversationUi.clear(); profileUi.clear(); activeConversationSession = unsignedConversation;
  aiGuideController.switchSession(unsignedConversation.id);
  tripWorkspaceController.activateSession(unsignedConversation.id);
  contextWorkspaceController.activateSession(unsignedConversation.id);
  if (!isSignedIn()) { void serverTripList.refresh(); return; }
  void serverTripList.refresh();
  void Promise.all([conversationUi.hydrate(), profileUi.hydrate()]).then(async ([session]) => {
    if (generation !== authenticationGeneration) return;
    const selected = session ?? await conversationUi.create();
    if (generation !== authenticationGeneration) return;
    await activateConversation(selected.id);
    let pending: string | undefined;
    try { pending = sessionStorage.getItem(pendingConsultationKey)?.slice(0, 400); sessionStorage.removeItem(pendingConsultationKey); } catch { /* Storage denial only prevents automatic return. */ }
    if (pending?.trim() && generation === authenticationGeneration) aiGuideController.ask(pending.trim());
  }).catch(() => undefined);
});
configureApplicationSettingsPanel(document, {
  travelProfileToggle,
  transferPace: journeyTransferPace,
  rankingPreference: journeyRankingPreference,
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
    returnToConversation();
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
if (isSignedIn()) {
  try {
    const pending = sessionStorage.getItem(pendingConsultationKey)?.slice(0, 400); sessionStorage.removeItem(pendingConsultationKey);
    if (pending?.trim()) aiGuideController.ask(pending.trim());
  } catch { /* Storage denial only prevents automatic return. */ }
}
applyContextWorkspaceState();
if (import.meta.env.DEV && new URLSearchParams(window.location.search).get("trip-workspace-preview") === "1") {
  if (!token) mapTools.hidden = true;
  loadingScreen.complete();
  document.querySelector<HTMLDialogElement>("#travel-profile-dialog")?.close();
  void import("../dev/trip-workspace-preview").then(({ tripWorkspacePreviewSource }) => {
    tripWorkspaceController.attach(activeConversationSession.id, tripWorkspacePreviewSource());
    tripWorkspace.show("trip");
  });
}

const initialDateTime = new Date();
handleAiGuidePrompt = async (prompt, _preferences, _conversation, _metadata, execution) => {
  if (activeConversationSession.tripId && tripWorkspaceController.current()?.id !== activeConversationSession.tripId) {
    throw new Error("対象の旅程を再取得してから相談してください。");
  }
  return serverAgentSession.start(prompt, execution?.requestedResearchMode ?? "standard", execution?.researchTarget)
    .send(event => { if (event.type === "progress") execution?.onProgress?.(event.phase); });
};

resolveAiGuidePromptHandler(handleAiGuidePrompt);
let displayedServiceDateStart = operatingServiceDateStart(initialDateTime);
displayTime.value = String(currentRouteTime(initialDateTime));

let mapStarted = false;
const homePreview = import.meta.env.DEV ? new URLSearchParams(window.location.search).get("home-preview") : null;
startMap = async () => {
  if (!isSignedIn()) {
    await currentAuthentication().login();
    return;
  }
  if (mapStarted) return;
  mapStarted = true;
  loadingScreen.start("地図と列車表示を読み込んでいます。");
  status.hidden = false; status.textContent = "地図と列車表示を読み込んでいます。";
  try { await initializeMap(); }
  catch { mapStarted = false; status.hidden = false; status.textContent = "地図を起動できませんでした。もう一度開くと再試行できます。相談は引き続き利用できます。"; loadingScreen.fail(status.textContent); }
};
primaryShell = configureAiFirstShell(document, app, {
  read: () => {
    const source = tripWorkspaceController.source(), trip = tripWorkspaceController.current();
    const load = tripWorkspaceController.loadState();
    const listState = serverTripList.getState();
    return {
      state: homePreview === "loading" ? "loading" : homePreview === "error" ? "unavailable" : homePreview === "empty" ? "available"
        : listState,
      trips: listState === "available" ? serverTripList.getTrips() : [], readiness: trip && source && load === "loaded" ? tripWorkspaceController.readiness() : undefined,
      candidates: tripWorkspaceController.candidates().map(({ candidate, assessment }) => ({
        id: candidate.id, title: candidate.experiences[0]?.name ?? candidate.accommodations[0]?.name ?? "移動の候補", assessment,
      })),
      preview: !!homePreview || (import.meta.env.DEV && new URLSearchParams(window.location.search).get("trip-workspace-preview") === "1"),
    };
  },
  subscribe: (listener) => {
    const left = tripWorkspaceController.subscribe(listener), middle = profileUi.subscribe(listener), right = serverTripList.subscribe(listener), auth = currentAuthentication().subscribe(listener);
    return () => { left(); middle(); right(); auth(); };
  },
  authState: () => currentAuthentication().getState(), login: () => { void currentAuthentication().login(); }, logout: () => { void currentAuthentication().logout(); },
  retry: async () => { await serverTripList.refresh(); await tripWorkspaceController.source()?.retry?.(); },
  newConsultation: (prompt) => { void startNewConsultation(prompt).catch(() => aiGuideController.notify("相談を始めるにはログインしてください。")); },
  openChat: () => { aiGuideController.open(); if (tripWorkspaceController.current()) tripWorkspace.show("chat"); delete app.dataset.mapFocusMode; },
  openTrip: (id) => { void tripNavigation.open(id, "trip").catch(() => aiGuideController.notify("旅程を読み込めませんでした。")); },
  openTravelMode: (id) => { void tripNavigation.open(id, "trip").then(() => tripWorkspace.openTravelMode()).catch(() => aiGuideController.notify("旅行モードを開けませんでした。")); },
  consultTrip: (id) => { void tripNavigation.open(id, "chat").catch(() => aiGuideController.notify("対象の旅程を読み込めませんでした。")); },
  renameTrip: async (id, title) => {
    const current = await serverTripClient.get(id); if (!current) throw new Error("Trip unavailable");
    await serverTripClient.mutate({ tripId: id, baseRevision: current.revision, mutationId: crypto.randomUUID(),
      proposal: { tripId: id, baseRevision: current.revision, summary: "旅程名を変更", patches: [{ type: "title", title }] } });
    await serverTripList.refresh();
  },
  archiveTrip: async (id) => { await serverTripClient.archive(id); await serverTripList.refresh(); },
  openMap: () => { void startMap(); selectSidebarMapMode(); },
  journeySettings: () => ({ transferPace: journeyTransferPace.value, rankingPreference: journeyRankingPreference.value }),
  setJourneySettings: ({ transferPace, rankingPreference }) => {
    journeyTransferPace.value = transferPace; journeyTransferPace.dispatchEvent(new Event("change", { bubbles: true }));
    journeyRankingPreference.value = rankingPreference; journeyRankingPreference.dispatchEvent(new Event("change", { bubbles: true }));
  },
  openNotifications: () => document.getElementById("sidebar-notifications")?.click(),
  canLeave: () => tripWorkspace.canLeave(),
  now: () => new Date(),
});
configureTravelProfile(document, profileUi);
loadingScreen.complete();
const consultationScreen = configureConsultationScreen(aiGuidePanel, aiGuideMessages, aiGuideForm, aiGuideInput, {
  read: () => ({ sessionId: tripWorkspaceController.sessionId(), trip: tripWorkspaceController.current() ?? (isSignedIn() && !activeConversationSession.tripId ? conversationUi.draftView(activeConversationSession.id) : undefined),
    pendingDraft: pendingDraftTripIds.has(activeConversationSession.id),
    draft: isSignedIn() && !activeConversationSession.tripId && !tripWorkspaceController.current(),
    unavailable: tripWorkspaceController.blocksLegacy() && !tripWorkspaceController.current(),
    viewer: tripWorkspaceController.source()?.getRole?.() === "viewer" }),
  profile: () => profileUi.current()?.profile, subscribe: (listener) => {
    const left = tripWorkspaceController.subscribe(listener), right = profileUi.subscribe(listener), draft = conversationUi.subscribe(listener);
    return () => { left(); right(); draft(); };
  },
  preview: (proposal) => { tripWorkspaceController.preview(proposal); tripWorkspace.show("trip"); },
  showTrip: () => { if (tripWorkspaceController.current()) tripWorkspace.show("trip"); },
  newConversation: () => { void createAndActivateConversation().then(() => aiGuideController.open()).catch(() => aiGuideController.notify("相談を始めるにはログインしてください。")); },
  cancelDraftTrip: () => { pendingDraftTripIds.delete(activeConversationSession.id); },
  saveDraftRequest: async (next, expected) => {
    const id = activeConversationSession.id, account = serverTripClient.sessionVersion();
    if (pendingDraftTripIds.has(id)) throw new Error("仮旅程の保存を再試行してから、条件を編集してください。");
    await conversationUi.saveDraftRequest(id, expected, next);
    if (activeConversationSession.id === id && account === serverTripClient.sessionVersion()) {
      activeConversationSession = conversationUi.list().find(session => session.id === id)!;
      serverAgentSession.contextChanged();
    }
  },
  saveDraftTrip: async () => {
    if (!isSignedIn()) throw new Error("Authentication required");
    const conversationId = activeConversationSession.id;
    if (activeConversationSession.tripId) return;
    const attempt = pendingDraftTripIds.get(conversationId) ?? { id: crypto.randomUUID(), now: new Date().toISOString(), request: structuredClone(conversationUi.draftView(conversationId)?.request ?? { constraints: [], assumptions: [] }) };
    pendingDraftTripIds.set(conversationId, attempt);
    const account = serverTripClient.sessionVersion();
    // Copy only explicitly saved conditions; do not invent schedules, prices or adopted candidates.
    const created = await createConversationDraftTrip({ conversationId, tripId: attempt.id, now: attempt.now, request: attempt.request, client: serverTripClient, conversations: serverConversationClient });
    await conversationUi.refresh(conversationId);
    const linked = conversationUi.list().find((session) => session.id === conversationId);
    if (!linked?.tripId || linked.tripId !== created.id) throw new Error("Conversation reference unavailable");
    pendingDraftTripIds.delete(conversationId);
    if (activeConversationSession.id !== conversationId || account !== serverTripClient.sessionVersion()) { void serverTripList.refresh(); return; }
    activeConversationSession = linked; syncServerTripSource(linked);
    tripWorkspaceController.activateSession(linked.id);
    await tripWorkspaceController.source()?.retry?.(); await serverTripList.refresh();
    if (activeConversationSession.id === conversationId && account === serverTripClient.sessionVersion()) tripWorkspace.show("trip");
  },
});
canLeaveConditions = () => consultationScreen.canLeave() && tripWorkspace.canLeave();
if (import.meta.env.DEV && homePreview === "data") {
  void import("../dev/home-preview").then(({ homePreviewSource }) => tripWorkspaceController.attach(activeConversationSession.id, homePreviewSource()));
}

async function initializeMap() {
const [{ default: mapboxgl }, { MapboxThreeTrainLayer }, { createTripMapOverlay }, { createVerifiedPlaceLayer }] = await Promise.all([
  import("mapbox-gl"),
  import("../presentation/train-viewer/rendering/mapbox-three-train-layer"),
  import("../adapters/mapbox/trip-map-overlay"),
  import("../adapters/mapbox/place-media-layer"),
  import("mapbox-gl/dist/mapbox-gl.css"),
]);
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
  tripMapOverlay = createTripMapOverlay(map, (itemId) => { tripWorkspaceController.focus(itemId); });
  if (pendingTripMap) tripMapOverlay.show(pendingTripMap.key, pendingTripMap.points, pendingTripMap.routes, pendingTripMap.itemId);
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
        closeMapPlaceDetail.click();
        tripWorkspace.show("chat");
        aiGuideController.ask(`${candidate.name}を宿泊候補として相談したい（まだ採用していません）`);
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
    loadingScreen.setStep("map", "complete");
    loadingScreen.setStep("routes", "loading");
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
      loadingScreen.setStep("routes", "loading");
      loadingScreen.setMessage("鉄道路線を読み込んでいます。");
      const routeLoadStartedAt = performance.now();
      const catalog = await loadPathCatalog();
      metrics.recordRouteLoad(performance.now() - routeLoadStartedAt);
      runtimeMonitor.log();
      loadingScreen.setStep("routes", "complete");

      status.textContent = "列車を読み込んでいます。";
      loadingScreen.setStep("trains", "loading");
      loadingScreen.setMessage("列車と時刻表を読み込んでいます。");
      const trainLoadStartedAt = performance.now();
      const trainIndex = await loadTrainIndex();
      loadingScreen.setStep("trains", "complete");
      const stationLineCatalog =
        trainIndex.station_line_catalog ?? emptyStationLineCatalog();
      if (!trainIndex.station_line_catalog) {
        console.warn(
          "[Raiquora] train_indexに駅・路線カタログがないため、路線色をグレーで表示します。",
        );
      }
      const geometry = new PathGeometryIndex(catalog.paths);
      tripRouteGeometry = (trip) => projectTripRouteGeometry(trip, trainIndex, geometry);
      if (pendingTripMap) {
        const trip = tripWorkspaceController.current();
        if (trip && pendingTripMap.key === `${trip.id}:${trip.revision}`) {
          const routes = tripRouteGeometry(trip); pendingTripMap = { ...pendingTripMap, routes };
          tripMapOverlay?.show(`${pendingTripMap.key}:geometry`, pendingTripMap.points, routes, pendingTripMap.itemId);
        }
      }
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
      loadingScreen.setStep("draw", "loading");
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
      loadingScreen.setStep("draw", "complete");

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
        const localWeatherLayer = createLocalWeatherLayer(map, applyAutomaticWeather);
        const localizedWeatherSearch = weatherPreviewEnabled
          ? (await import("../dev/weather-grid-preview")).searchWeatherGridPreview
          : searchWeatherGrid;
        const localWeatherUpdates = configureLocalWeatherUpdates(
          map,
          localWeatherLayer,
          localizedWeatherSearch,
          () => undefined,
        );
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
          const sourceOperations = realtimeOperations ?? new Map<string, TrainOperation>();
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
          app.dataset.displayMode = "digital-twin";
          congestionUpdates.setAvailable(realtimeOperations !== undefined);
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
            mode: "realtime",
            timetableTrains: trainIndex.trains.length,
            displayedTrains: displayTrains.length,
            unobservedTimetableEntries: trainIndex.trains.length - displayTrains.length,
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
          const hitSource = map.getSource("train-hit-targets") as import("mapbox-gl").GeoJSONSource;
          const trainLayouts = coupledTrainLayouts(positions, formationLinks);
          hitSource.setData({
            type: "FeatureCollection",
            features: trainHitTargetsFor(trainLayouts).map((target) => ({
              type: "Feature" as const,
              properties: { service_uid: target.serviceUid },
              geometry: { type: "Point" as const, coordinates: target.coordinate },
            })),
          });
          status.hidden = true;
          metrics.recordPositionUpdate(performance.now() - updateStartedAt, positions.length);
          runtimeMonitor.log();
        };

        const disposeDelayUpdates = configureTrainDelayUpdates((snapshot) => {
          latestDelaySnapshot = snapshot;
          updateTrains();
        }, realtimeUpdateDependencies);
        const synchronizeRealtimeClock = (now: Date) => {
          displayedServiceDateStart = operatingServiceDateStart(now);
          displayTime.value = String(currentRouteTime(now));
          updateTrains();
          localWeatherUpdates.scheduleRefresh();
        };
        const realtimeClock = createDigitalTwinClockSynchronizer(
          synchronizeRealtimeClock,
          browserDigitalTwinClockEnvironment(),
        );
        realtimeClock.setEnabled(true);
        const realtimeClockInterval = window.setInterval(() => {
          if (document.visibilityState === "visible") synchronizeRealtimeClock(new Date());
        }, 15_000);
        disposeDataUpdates = () => {
          congestionUpdates.dispose();
          disposeDelayUpdates();
          localWeatherUpdates.dispose();
          realtimeClock.dispose();
          window.clearInterval(realtimeClockInterval);
        };
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
