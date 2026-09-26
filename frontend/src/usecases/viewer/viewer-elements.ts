export interface ViewerElements {
  app: HTMLElement;
  loadingScreenElement: HTMLElement;
  loadingScreenMessage: HTMLElement;
  loadingScreenRetry: HTMLButtonElement;
  loadingSteps: HTMLElement[];
  status: HTMLParagraphElement;
  contextWorkspaceTabs: HTMLElement;
  closeContextWorkspace: HTMLButtonElement;
  displayTime: HTMLInputElement;
  mapTools: HTMLElement;
  congestionToggle: HTMLButtonElement;
  aiGuidePanel: HTMLElement;
  closeAiGuide: HTMLButtonElement;
  aiGuideMessages: HTMLOListElement;
  aiGuideForm: HTMLFormElement;
  aiGuideInput: HTMLInputElement;
  aiGuideSubmit: HTMLButtonElement;
  sidebarRealtimeMap: HTMLButtonElement;
  travelProfileToggle: HTMLButtonElement;
  aiGuideSuggestions: HTMLButtonElement[];
  aiGuideContextChoices: HTMLElement;
  journeySettingsToggle: HTMLButtonElement;
  journeySettingsPanel: HTMLElement;
  journeyTransferPace: HTMLSelectElement;
  journeyRankingPreference: HTMLSelectElement;
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
    loadingSteps: requiredAll(root, "[data-loading-step]", 4, 4),
    status: required(root, "#map-status"),
    contextWorkspaceTabs: required(root, "#context-workspace-tabs"),
    closeContextWorkspace: required(root, "#close-context-workspace"),
    displayTime: required(root, "#display-time"),
    mapTools: required(root, "#map-tools"),
    congestionToggle: required(root, "#congestion-toggle"),
    aiGuidePanel: required(root, "#ai-guide-panel"),
    closeAiGuide: required(root, "#close-ai-guide"),
    aiGuideMessages: required(root, "#ai-guide-messages"),
    aiGuideForm: required(root, "#ai-guide-form"),
    aiGuideInput: required(root, "#ai-guide-input"),
    aiGuideSubmit: required(root, "#ai-guide-submit"),
    sidebarRealtimeMap: required(root, "#sidebar-realtime-map"),
    travelProfileToggle: required(root, "#travel-profile-toggle"),
    aiGuideSuggestions: all(root, "[data-prompt]"),
    aiGuideContextChoices: required(root, "#ai-guide-context-choices"),
    journeySettingsToggle: required(root, "#journey-settings-toggle"),
    journeySettingsPanel: required(root, "#journey-settings-panel"),
    journeyTransferPace: required(root, "#journey-transfer-pace"),
    journeyRankingPreference: required(root, "#journey-ranking-preference"),
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
