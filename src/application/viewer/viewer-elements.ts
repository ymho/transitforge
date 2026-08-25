export interface ViewerElements {
  app: HTMLElement;
  loadingScreenElement: HTMLElement;
  loadingScreenMessage: HTMLElement;
  loadingScreenRetry: HTMLButtonElement;
  status: HTMLParagraphElement;
  displayTime: HTMLInputElement;
  dateTimeInput: HTMLInputElement;
  dateTimeDate: HTMLElement;
  dateTimeClock: HTMLTimeElement;
  playToggle: HTMLButtonElement;
  currentTimeButton: HTMLButtonElement;
  playbackSpeed: HTMLInputElement;
  playbackSpeedMenuToggle: HTMLButtonElement;
  playbackSpeedOptions: HTMLFieldSetElement;
  playbackSpeedButtons: HTMLButtonElement[];
  mapTools: HTMLElement;
  weatherButtons: HTMLButtonElement[];
  weatherMenuToggle: HTMLButtonElement;
  weatherOptions: HTMLFieldSetElement;
  congestionToggle: HTMLButtonElement;
  destinationArcsToggle: HTMLButtonElement;
  digitalTwinModeToggle: HTMLButtonElement;
  aiGuidePanel: HTMLElement;
  aiGuideToggle: HTMLButtonElement;
  closeAiGuide: HTMLButtonElement;
  aiGuideMessages: HTMLOListElement;
  aiGuideForm: HTMLFormElement;
  aiGuideInput: HTMLInputElement;
  aiGuideSubmit: HTMLButtonElement;
  conciergeAvatar: HTMLImageElement;
  conciergeName: HTMLElement;
  conciergeRole: HTMLElement;
  aiGuideSuggestions: HTMLButtonElement[];
  aiGuideContextChoices: HTMLElement;
  journeySettingsToggle: HTMLButtonElement;
  journeySettingsPanel: HTMLElement;
  journeyTransferPace: HTMLSelectElement;
  journeyRankingPreference: HTMLSelectElement;
  tripPlanToggle: HTMLButtonElement;
  tripPlanPanel: HTMLElement;
  tripPlanContent: HTMLElement;
  closeTripPlan: HTMLButtonElement;
  trainDetails: HTMLElement;
  closeTrainDetails: HTMLButtonElement;
  selectedTrainTitle: HTMLElement;
  selectedTrainDelay: HTMLElement;
  selectedTrainStopping: HTMLElement;
  selectedTrainStops: HTMLOListElement;
  trainDetailTabs: HTMLElement;
}

export function loadViewerElements(root: ParentNode): ViewerElements {
  return {
    app: required(root, "#app"),
    loadingScreenElement: required(root, "#loading-screen"),
    loadingScreenMessage: required(root, "#loading-screen-message"),
    loadingScreenRetry: required(root, "#loading-screen-retry"),
    status: required(root, "#map-status"),
    displayTime: required(root, "#display-time"),
    dateTimeInput: required(root, "#date-time-input"),
    dateTimeDate: required(root, "#date-time-date"),
    dateTimeClock: required(root, "#date-time-clock"),
    playToggle: required(root, "#play-toggle"),
    currentTimeButton: required(root, "#current-time-button"),
    playbackSpeed: required(root, "#playback-speed"),
    playbackSpeedMenuToggle: required(root, "#playback-speed-menu-toggle"),
    playbackSpeedOptions: required(root, "#playback-speed-options"),
    playbackSpeedButtons: requiredAll(root, "[data-playback-speed]", 1),
    mapTools: required(root, "#map-tools"),
    weatherButtons: requiredAll(root, "[data-weather]", 4, 4),
    weatherMenuToggle: required(root, "#weather-menu-toggle"),
    weatherOptions: required(root, "#weather-options"),
    congestionToggle: required(root, "#congestion-toggle"),
    destinationArcsToggle: required(root, "#destination-arcs-toggle"),
    digitalTwinModeToggle: required(root, "#digital-twin-mode-toggle"),
    aiGuidePanel: required(root, "#ai-guide-panel"),
    aiGuideToggle: required(root, "#ai-guide-toggle"),
    closeAiGuide: required(root, "#close-ai-guide"),
    aiGuideMessages: required(root, "#ai-guide-messages"),
    aiGuideForm: required(root, "#ai-guide-form"),
    aiGuideInput: required(root, "#ai-guide-input"),
    aiGuideSubmit: required(root, "#ai-guide-submit"),
    conciergeAvatar: required(root, "#concierge-avatar"),
    conciergeName: required(root, "#concierge-name"),
    conciergeRole: required(root, "#concierge-role"),
    aiGuideSuggestions: all(root, "[data-prompt]"),
    aiGuideContextChoices: required(root, "#ai-guide-context-choices"),
    journeySettingsToggle: required(root, "#journey-settings-toggle"),
    journeySettingsPanel: required(root, "#journey-settings-panel"),
    journeyTransferPace: required(root, "#journey-transfer-pace"),
    journeyRankingPreference: required(root, "#journey-ranking-preference"),
    tripPlanToggle: required(root, "#trip-plan-toggle"),
    tripPlanPanel: required(root, "#trip-plan-panel"),
    tripPlanContent: required(root, "#trip-plan-content"),
    closeTripPlan: required(root, "#close-trip-plan"),
    trainDetails: required(root, "#train-details"),
    closeTrainDetails: required(root, "#close-train-details"),
    selectedTrainTitle: required(root, "#selected-train-title"),
    selectedTrainDelay: required(root, "#selected-train-delay"),
    selectedTrainStopping: required(root, "#selected-train-stopping"),
    selectedTrainStops: required(root, "#selected-train-stops"),
    trainDetailTabs: required(root, "#train-detail-tabs"),
  };
}

function required<Element extends globalThis.Element>(
  root: ParentNode,
  selector: string,
): Element {
  const element = root.querySelector<Element>(selector);
  if (!element) throw new Error(`Viewer element is missing: ${selector}`);
  return element;
}

function requiredAll<Element extends globalThis.Element>(
  root: ParentNode,
  selector: string,
  minimum: number,
  maximum = Number.POSITIVE_INFINITY,
): Element[] {
  const elements = all<Element>(root, selector);
  if (elements.length < minimum || elements.length > maximum) {
    throw new Error(
      `Viewer elements have an unexpected count: ${selector} (${elements.length})`,
    );
  }
  return elements;
}

function all<Element extends globalThis.Element>(
  root: ParentNode,
  selector: string,
): Element[] {
  return Array.from(root.querySelectorAll<Element>(selector));
}
