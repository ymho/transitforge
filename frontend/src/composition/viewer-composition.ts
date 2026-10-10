import { startTripConsultation } from "../usecases/trip-plan/start-trip-consultation";
import { proposeTripItemChange } from "@raiquora/trip/trip-item-proposal";
import { projectDailyItinerary } from "@raiquora/trip/daily-itinerary";
import { createTripConsultationNavigation } from "../usecases/trip-plan/trip-consultation-navigation";
import { currentAuthentication } from "./auth-composition";
import { createConversationStreamSession } from "../adapters/http/agent-stream/session";

import { accommodationProviderAttributionFromEnvironment } from "../adapters/browser/accommodation-provider-attribution";
import { browserDigitalTwinClockEnvironment } from "../adapters/browser/digital-twin-clock-environment";
import { browserPollingEnvironment } from "../adapters/browser/polling-controller";
import { createRuntimeMonitor, nextBrowserFrame } from "../adapters/browser/runtime-monitor";
import { applyWeather } from "../adapters/mapbox/map-weather";
import { createLocalWeatherLayer } from "../adapters/mapbox/local-weather-layer";
import { createGroundAccessLayer, type GroundAccessLayerController } from "../adapters/mapbox/ground-access-layer";
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
import { searchWeatherGrid } from "../adapters/http/agent-api/bedrock-agent";
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
import { currentRouteTime, operatingDayStartMinutes } from "../domain/playback";
import { PlaybackController } from "../domain/playback-controller";
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
import { configureTrainSelection } from "../presentation/train-viewer/train-selection-controller";
import {
  configureTrainCongestionUpdates,
  configureTrainDelayUpdates,
} from "../usecases/train-viewer/realtime-updates";
import { configureLocalWeatherUpdates } from "../usecases/train-viewer/local-weather-updates";
import { configureSidebarMapModeSelection } from "../presentation/train-viewer/map-controls";
import { applyOperationBasemapConfig, operationBasemapConfig } from "../presentation/train-viewer/operation-map-basemap";
import { createLoadingScreen } from "../presentation/shared/loading-screen";
import { RuntimeMetrics } from "../observability/runtime-metrics";
import { configureTravelProfile } from "../presentation/concierge/travel-profile-panel";
import { HttpServerProfileClient } from "../adapters/http/server-profile-client";
import { ProfileUiController } from "../usecases/personal-state/profile-ui-controller";
import { HttpServerConversationClient, reportConversationReadFailure } from "../adapters/http/server-conversation-client";
import { ConversationUiController } from "../usecases/personal-state/conversation-ui-controller";
import { configureApplicationSettingsPanel } from "../presentation/settings/application-settings-panel";
import { createTripWorkspaceController } from "../usecases/trip-plan/trip-workspace-controller";
import { createReferencedTripSource } from "../usecases/trip-plan/server-trip-workspace-source";
import { HttpServerTripClient } from "../adapters/http/server-trip-client";
import { createServerTripListSource } from "../usecases/trip-plan/server-trip-list-source";
import { HttpNotificationClient } from "../adapters/http/notification-client";
import { configureNotificationCenter } from "../presentation/notifications/notification-center";
import { configureTripSharing } from "../presentation/trip-plan/trip-sharing-panel";
import "../presentation/trip-plan/trip-sharing-panel.css";
import { HttpTripSharingClient } from "../adapters/http/trip-sharing-client";
import { consumeTripShareLink, consumeShareLogin, saveShareLogin, makeTripShareLink, parseTripShareLink } from "../adapters/browser/trip-share-link";
import { configureTripWorkspace } from "../presentation/trip-plan/trip-workspace";
import { projectTripPlaces } from "@raiquora/trip/trip-places";
import type { TripMapOverlay, TripMapPoint, TripMapRoute } from "../adapters/mapbox/trip-map-overlay";
import { projectTripRouteGeometry } from "../domain/trip-route-geometry";
import { HttpInTripContextClient } from "../adapters/http/in-trip-context-client";
import { BrowserContextWorkspaceRepository } from "../adapters/browser/context-workspace-repository";
import type { ConversationSession } from "../domain/conversation-session";
import { createContextWorkspaceController } from "../usecases/context-workspace/context-workspace-controller";
import { createMobileContextNavigation } from "../presentation/concierge/mobile-context-navigation";

export async function startViewer(): Promise<void> {
let resumedShareLink;
try { resumedShareLink = consumeShareLogin(window.sessionStorage); } catch { /* Storage may be unavailable. */ }
const initialShareLink = consumeTripShareLink(window.location, window.history) ?? resumedShareLink;

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
  congestionToggle,
  aiGuidePanel,
  closeAiGuide,
  aiGuideMessages,
  aiGuideForm,
  aiGuideInput,
  aiGuideSubmit,
  sidebarRealtimeMap,
  travelProfileToggle,
  aiGuideSuggestions,
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
  id: "ui-unauthenticated", title: "新しい旅", scope: "trip", summary: "", resolvedTopics: [], pendingTopics: [],
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
};
let activeConversationSession = unsignedConversation;
const isSignedIn = canUsePersonalState;
if (isSignedIn()) {
  try {
    // No standalone-chat restoration or empty server conversation at startup.
    await profileUi.hydrate();
  } catch { conversationUi.clear(); profileUi.clear(); }
}
let aiGuideController: ReturnType<typeof configureAiGuidePanel>;
let groundAccessLayer: GroundAccessLayerController | undefined;
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
const serverTripList = createServerTripListSource(serverTripClient, canUsePersonalState);
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
  realtimeModeButtons: [sidebarRealtimeMap],
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
  if (app.dataset.primaryView === "map") {
    if (conversationUi.active()) primaryShell?.showConversation(activeConversationSession.tripId);
    else primaryShell?.navigate("chat");
  }
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
sidebarRealtimeMap.addEventListener("click", selectSidebarMapMode);
// The consultation controller still manages panel state, but its old map button is gone.
const aiGuideToggle = document.createElement("button");
aiGuideToggle.type = "button";
const adoptPlan: NonNullable<Parameters<typeof configureAiGuidePanel>[0]["onPlanAdoption"]> = async (target) => {
  if (!serverTripClient.previewPlanAdoption || !serverTripClient.confirmPlanAdoption || activeConversationSession.id !== target.conversationId) throw new Error("Adoption unavailable");
  const preview = await serverTripClient.previewPlanAdoption(target);
  return { changes: preview.preview.changes, confirm: async () => {
    if (activeConversationSession.id !== target.conversationId) throw new Error("Conversation changed");
    await serverTripClient.confirmPlanAdoption!(target, preview.confirmationKey);
    await tripWorkspaceController.source()?.retry?.(); await serverTripList.refresh(); tripWorkspace.show("trip");
  } };
};
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
    onGroundRoute: (route, index) => {
      groundAccessLayer?.showGroundRoute(route, index);
      contextWorkspaceController.show("map");
    },
    persistent: () => true,
    responseContextKey: () => JSON.stringify([serverAgentSession.contextVersion(), activeConversationSession.id, tripWorkspaceController.current()?.id, tripWorkspaceController.current()?.revision]),
    onPlanPresentation: (value, open) => {
      const conversationId = activeConversationSession.id;
      void serverTripList.refresh().catch(() => undefined);
      void tripWorkspaceController.source()?.retry?.().then(() => {
        if (activeConversationSession.id !== conversationId || activeConversationSession.tripId !== value.target?.tripId) return;
        try { tripWorkspaceController.presentPlan(value); if (open) tripWorkspace.showPlan(); } catch { /* Ignore stale retained history. */ }
      }).catch(() => { if (open) aiGuideController.notify("旅程案は相談に表示しました。旅程を再読み込みして確認してください。"); });
    },
    onTripConditionsSaved: () => {
      // Reload after rendering, so our own saved revision does not invalidate its response.
      // The source owns auth/session fencing and publishes the server's current Trip.
      const source = tripWorkspaceController.source();
      void source?.retry?.().catch(() => undefined);
      void serverTripList.refresh().catch(() => undefined);
    },
    onTripCostProposal: (proposal) => {
      try { tripWorkspaceController.preview(proposal); tripWorkspace.show("trip"); }
      catch { aiGuideController.notify("旅程が変わったため費用案を適用できません。現在の旅程で再予測してください。"); }
    },
    onTripUpdateProposal: (proposal) => {
      if (!tripWorkspaceController.current()) return;
      try { tripWorkspaceController.preview(proposal); tripWorkspace.show("trip"); }
      catch { tripWorkspace.report("変更案を現在の旅程に適用できません。会話で確認し直してください。"); }
    },
    placeMemoTargets: () => {
      const trip = tripWorkspaceController.current();
      if (!trip || tripWorkspaceController.source()?.getRole?.() === "viewer" || activeConversationSession.tripId !== trip.id) return [];
      return [{ key: "unscheduled", label: "日時未定" }, ...projectDailyItinerary(trip, { limit: 90 }).days.map(({ dayKey, label }) => ({ key: dayKey, label }))];
    },
    onPlaceMemoProposal: (card, dayKey, category) => {
      const trip = tripWorkspaceController.current();
      if (!trip || tripWorkspaceController.source()?.getRole?.() === "viewer" || activeConversationSession.tripId !== trip.id || !card.retrievedAt)
        throw new Error("Trip or cited date unavailable");
      tripWorkspaceController.preview(proposeTripItemChange(trip, { action: "add-researched-activity", itemId: crypto.randomUUID(),
        dayKey, title: card.title, category, sourceUrl: card.sourceUrl, observedAt: card.retrievedAt }));
      tripWorkspace.show("trip");
    },
    onPlanAdoption: adoptPlan,
  },
  (prompt, preferences, onResponseMetadata, options) =>
    handleAiGuidePrompt(
      prompt,
      preferences,
      onResponseMetadata,
      options,
    ),
);
let openBranchedTrip: (trip: import("@raiquora/trip/trip").Trip, title: string) => Promise<void> = async () => { throw new Error("Branch navigation unavailable"); };
const tripWorkspace = configureTripWorkspace({
    showTripList: () => primaryShell?.navigate("trips"),
  conversationId: () => activeConversationSession.id, onPlanAdoption: adoptPlan,
  app, chat: aiGuidePanel, messages: aiGuideMessages, input: aiGuideInput,
  controller: tripWorkspaceController,
  showContext: (view) => contextWorkspaceController.show(view), returnToConversation,
  onViewChange: (view) => {
    const trip = tripWorkspaceController.current();
    if (view === "trip" && trip) primaryShell?.showTrip(trip.id);
    else if (view === "chat") primaryShell?.showConversation(trip?.id);
  },
  showMap: focusTripMap, loadInTripContext: (tripId) => inTripContextClient.read(tripId),
  ask: (prompt) => aiGuideController.ask(prompt), nextItemId: () => crypto.randomUUID(),
  openSharing: () => tripSharing.open(),
  changeAdoption: async (trip, action) => {
    if (!serverTripClient.previewTripAdoption || !serverTripClient.confirmTripAdoption) throw new Error("Trip adoption unavailable");
    const target = { tripId: trip.id, baseTripRevision: trip.revision, mutationId: crypto.randomUUID(), action };
    const preview = await serverTripClient.previewTripAdoption(target);
    await serverTripClient.confirmTripAdoption(target, preview.confirmationKey);
    await tripWorkspaceController.source()?.retry?.(); await serverTripList.refresh();
  },
  changeItemDecision: async (trip, item, action) => {
    if (!serverTripClient.previewItemDecision || !serverTripClient.confirmItemDecision) throw new Error("Item decision unavailable");
    const target = { tripId: trip.id, itemId: item.id, baseTripRevision: trip.revision, mutationId: crypto.randomUUID(), action };
    const preview = await serverTripClient.previewItemDecision(target);
    await serverTripClient.confirmItemDecision(target, preview.confirmationKey);
    await tripWorkspaceController.source()?.retry?.(); await serverTripList.refresh();
  },
  branchTrip: (trip, title) => openBranchedTrip(trip, title),
});
let canLeaveConditions = () => true;
const activateConversation = async (sessionId: string) => {
  if (activeConversationSession.id !== sessionId && !canLeaveConditions()) throw new Error("Navigation cancelled");
  const session = conversationUi.selectLocal(sessionId);
  if (!session) return;
  returnToConversation(); activeConversationSession = session;
  serverAgentSession.contextChanged(); syncServerTripSource(session);
  tripWorkspaceController.activateSession(session.id); contextWorkspaceController.activateSession(session.id);
  aiGuideController.switchSession(session.id);
  aiGuideInput.disabled = true; aiGuideSubmit.disabled = true;
  try { await conversationUi.loadHistory(session.id); }
  catch (error) { reportConversationReadFailure("history", error); throw error; }
  if (conversationUi.active()?.id === session.id) {
    activeConversationSession = conversationUi.active()!;
    syncServerTripSource(activeConversationSession);
    tripWorkspaceController.activateSession(session.id);
    try { aiGuideController.switchSession(session.id); }
    catch (error) { reportConversationReadFailure("render", error); throw error; }
  }
};
openBranchedTrip = async (trip, title) => {
  if (!serverTripClient.branchConsultation) throw new Error("Trip branching unavailable");
  const account = serverTripClient.sessionVersion(), result = await serverTripClient.branchConsultation({
    sourceTripId: trip.id, sourceRevision: trip.revision, tripId: crypto.randomUUID(), title,
  });
  if (account !== serverTripClient.sessionVersion()) throw new Error("Session changed");
  await Promise.all([serverTripList.refresh(), conversationUi.hydrate()]);
  const session = await conversationUi.findForTrip(result.trip.id);
  if (!session || session.id !== result.conversationId) throw new Error("Branch history unavailable");
  await activateConversation(session.id); tripWorkspace.show("trip");
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
let pendingStart: { tripId: string; prompt: string; account: number | undefined } | undefined;
const resetConsultation = () => {
  pendingStart = undefined;
  tripNavigation.cancel(); conversationUi.clear();
  activeConversationSession = { ...unsignedConversation, id: `ui-new-${crypto.randomUUID()}` };
  serverAgentSession.contextChanged();
  tripWorkspaceController.activateSession(activeConversationSession.id);
  contextWorkspaceController.activateSession(activeConversationSession.id);
  aiGuideController.switchSession(activeConversationSession.id);
};
const startNewConsultation = async (prompt: string) => {
  if (!isSignedIn()) throw new Error("Authentication required");
  if (!canLeaveConditions()) throw new Error("Navigation cancelled");
  const navigation = tripNavigation.cancel(), account = serverTripClient.sessionVersion();
  const attempt = pendingStart?.prompt === prompt && pendingStart.account === account
    ? pendingStart : { tripId: crypto.randomUUID(), prompt, account };
  pendingStart = attempt;
  const isCurrent = () => isSignedIn() && navigation === tripNavigation.version() && account === serverTripClient.sessionVersion();
  const started = await startTripConsultation({
    prompt, tripId: attempt.tripId, isCurrent,
    start: value => serverTripClient.startConsultation(value),
    activate: async (conversationId, tripId) => {
      const session = await conversationUi.findForTrip(tripId);
      if (!isCurrent()) throw new Error("Consultation navigation changed");
      if (session?.id !== conversationId) throw new Error("Trip history read-back unavailable");
      await activateConversation(conversationId);
      if (!isCurrent()) throw new Error("Consultation navigation changed");
      const source = tripWorkspaceController.source();
      if (!source) throw new Error("Trip source unavailable");
      await source.retry?.();
      if (!isCurrent()) throw new Error("Consultation navigation changed");
    },
    current: () => ({ conversationId: activeConversationSession.id, tripId: tripWorkspaceController.current()?.id }),
    submit: value => aiGuideController.ask(value),
  });
  pendingStart = undefined;
  void serverTripList.refresh().catch(() => undefined);
  return { tripId: started.trip.id };
};
let initialAuthenticationNotification = true;
let authenticationGeneration = 0;
currentAuthentication().subscribe(() => {
  if (initialAuthenticationNotification) { initialAuthenticationNotification = false; return; }
  const generation = ++authenticationGeneration;
  pendingStart = undefined;
  tripNavigation.cancel(); serverTripReferences.clear();
  conversationUi.clear(); profileUi.clear(); activeConversationSession = unsignedConversation;
  aiGuideController.switchSession(unsignedConversation.id);
  tripWorkspaceController.activateSession(unsignedConversation.id);
  contextWorkspaceController.activateSession(unsignedConversation.id);
  if (!isSignedIn()) return;
  void profileUi.hydrate().catch(() => {
    if (generation === authenticationGeneration) profileUi.clear();
  });
});
configureApplicationSettingsPanel(document, {
  travelProfileToggle,
  transferPace: journeyTransferPace,
  rankingPreference: journeyRankingPreference,
  accommodationProviderAttribution: accommodationProviderAttributionFromEnvironment(import.meta.env),
});
configureNotificationCenter({ root: document.body,
  buttons: [document.getElementById("sidebar-notifications")!],
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
// Shared dialog is opened from the current Trip header.
const tripSharing = configureTripSharing({ root: document.body, button: sharingButton, client: new HttpTripSharingClient(), official: new HttpTripSharingClient(), initialLink: initialShareLink,
  authenticated: isSignedIn, resumeJoin: !!resumedShareLink && isSignedIn(),
  async login(link) { saveShareLogin(window.sessionStorage, link); await currentAuthentication().login(); },
  current: () => { const trip = tripWorkspaceController.current(); return trip ? { tripId: trip.id, role: tripWorkspaceController.source()?.getRole?.(), trip } : undefined; },
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
handleAiGuidePrompt = async (prompt, _preferences, _metadata, execution) => {
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
  library: new HttpTripSharingClient(), librarySession: () => serverTripClient.sessionVersion(),
  read: () => {
    const listState = serverTripList.getState();
    return {
      state: homePreview === "loading" ? "loading" : homePreview === "error" ? "unavailable" : homePreview === "empty" ? "available" : listState,
      trips: listState === "available" ? serverTripList.getTrips() : [],
    };
  },
  subscribe: (listener) => {
    const trips = serverTripList.subscribe(listener), auth = currentAuthentication().subscribe(listener);
    return () => { trips(); auth(); };
  },
  authState: () => currentAuthentication().getState(), login: () => { void currentAuthentication().login(); }, logout: () => { void currentAuthentication().logout(); },
  retry: async () => { await serverTripList.refresh(); },
  newConsultation: startNewConsultation,
  resetConsultation,
  cancelNavigation: () => { tripNavigation.cancel(); },
  openChat: () => { aiGuideController.open(); if (tripWorkspaceController.current()) tripWorkspace.show("chat"); delete app.dataset.mapFocusMode; },
  openTrip: (id) => tripNavigation.open(id, "trip"),
  openTravelMode: (id) => { void tripNavigation.open(id, "trip").then(() => tripWorkspace.openTravelMode()).catch(() => aiGuideController.notify("旅行モードを開けませんでした。")); },
  consultTrip: (id) => tripNavigation.open(id, "chat"),
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
  read: () => ({ sessionId: tripWorkspaceController.sessionId(), trip: tripWorkspaceController.current(),
    unavailable: tripWorkspaceController.blocksLegacy() && !tripWorkspaceController.current(),
    viewer: tripWorkspaceController.source()?.getRole?.() === "viewer" }),
  profile: () => profileUi.current()?.profile, subscribe: (listener) => {
    const left = tripWorkspaceController.subscribe(listener), right = profileUi.subscribe(listener), draft = conversationUi.subscribe(listener);
    return () => { left(); right(); draft(); };
  },
  preview: (proposal) => { tripWorkspaceController.preview(proposal); tripWorkspace.show("trip"); },
  showTrip: () => { if (tripWorkspaceController.current()) tripWorkspace.show("trip"); },
  newConversation: () => { primaryShell?.navigate("chat"); },

});
canLeaveConditions = () => consultationScreen.canLeave() && tripWorkspace.canLeave();
if (import.meta.env.DEV && homePreview === "data") {
  void import("../dev/home-preview").then(({ homePreviewSource }) => tripWorkspaceController.attach(activeConversationSession.id, homePreviewSource()));
}

async function initializeMap() {
const [{ default: mapboxgl }, { MapboxThreeTrainLayer }, { createTripMapOverlay }] = await Promise.all([
  import("mapbox-gl"),
  import("../presentation/train-viewer/rendering/mapbox-three-train-layer"),
  import("../adapters/mapbox/trip-map-overlay"),
  import("mapbox-gl/dist/mapbox-gl.css"),
]);
if (!token) {
  const missingTokenMessage =
    "現在、運行マップを表示できません。旅程や相談は引き続きご利用いただけます。";
  status.textContent = missingTokenMessage;
  loadingScreen.fail(missingTokenMessage);
} else {
  mapboxgl.accessToken = token;

  const map = new mapboxgl.Map({
    container: "map",
    style: "mapbox://styles/mapbox/standard",
    config: {
      basemap: operationBasemapConfig,
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

  let disposeDataUpdates = () => undefined;
  map.on("style.load", async () => {
    disposeDataUpdates();
    disposeDataUpdates = () => undefined;
    status.hidden = false;
    loadingScreen.setStep("map", "complete");
    loadingScreen.setStep("routes", "loading");
    loadingScreen.setMessage("地図の表示を整えています。");
    // Reapply the operation-screen basemap policy after every Mapbox style reload.
    applyOperationBasemapConfig(map);
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
          const sourceOperations = realtimeOperations;
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
          app.dataset.operationSource = realtimeOperations === undefined ? "timetable" : "realtime";
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
            mode: realtimeOperations === undefined ? "timetable" : "realtime",
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
        const realtimePlayback = new PlaybackController({
          initialRouteTime: Number(displayTime.value),
          range: {
            minimum: operatingDayStartMinutes,
            maximum: operatingDayStartMinutes + 24 * 60,
          },
          getMinutesPerSecond: () => 1 / 60,
          render: (routeTime) => {
            displayTime.value = String(routeTime);
            updateTrains(routeTime);
          },
          onOperatingDayWrapped: () => {
            displayedServiceDateStart = operatingServiceDateStart(new Date());
          },
          minimumRenderIntervalMilliseconds: 1_000 / 30,
        });
        const synchronizeRealtimeClock = (now: Date) => {
          displayedServiceDateStart = operatingServiceDateStart(now);
          realtimePlayback.synchronize(currentRouteTime(now));
          localWeatherUpdates.scheduleRefresh();
        };
        const realtimeClock = createDigitalTwinClockSynchronizer(
          synchronizeRealtimeClock,
          browserDigitalTwinClockEnvironment(),
        );
        realtimeClock.setEnabled(true);
        realtimePlayback.start();
        const realtimeClockInterval = window.setInterval(() => {
          if (document.visibilityState === "visible") synchronizeRealtimeClock(new Date());
        }, 15_000);
        disposeDataUpdates = () => {
          congestionUpdates.dispose();
          disposeDelayUpdates();
          localWeatherUpdates.dispose();
          realtimePlayback.stop();
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
