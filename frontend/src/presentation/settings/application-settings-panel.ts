import { externalServiceNote, renderExternalServiceList, type AccommodationProviderAttribution } from "./external-service-list";

export interface ApplicationSettingsPanelDependencies {
  travelProfileToggle: HTMLButtonElement;
  transferPace: HTMLSelectElement;
  rankingPreference: HTMLSelectElement;
  accommodationProviderAttribution: AccommodationProviderAttribution | null;
}

export function configureApplicationSettingsPanel(
  root: ParentNode,
  dependencies: ApplicationSettingsPanelDependencies,
): void {
  const dialog = required<HTMLDialogElement>(root, "#application-settings-dialog");
  const close = required<HTMLButtonElement>(dialog, "#close-application-settings");
  const settingsTransferPace = required<HTMLSelectElement>(dialog, "#settings-journey-transfer-pace");
  const settingsRankingPreference = required<HTMLSelectElement>(dialog, "#settings-journey-ranking-preference");
  const tabs = [...dialog.querySelectorAll<HTMLButtonElement>("[data-settings-tab]")];
  const views = [...dialog.querySelectorAll<HTMLElement>("[data-settings-view]")];
  const openers = [
    required<HTMLButtonElement>(root, "#sidebar-account-settings"),
  ];
  renderExternalServiceList(required<HTMLUListElement>(dialog, ".external-service-list"), dependencies.accommodationProviderAttribution);
  required<HTMLElement>(dialog, ".external-service-note").textContent = externalServiceNote;

  const selectTab = (tab: string) => {
    for (const button of tabs) {
      button.ariaPressed = String(button.dataset.settingsTab === tab);
    }
    for (const view of views) {
      view.hidden = view.dataset.settingsView !== tab;
    }
  };
  const synchronizeJourneyPreferences = () => {
    settingsTransferPace.value = dependencies.transferPace.value;
    settingsRankingPreference.value = dependencies.rankingPreference.value;
  };
  const updateCanonicalSelect = (
    canonical: HTMLSelectElement,
    value: string,
  ) => {
    canonical.value = value;
    canonical.dispatchEvent(new Event("change", { bubbles: true }));
  };
  const open = () => {
    synchronizeJourneyPreferences();
    selectTab("journey");
    dialog.showModal();
  };

  for (const opener of openers) opener.addEventListener("click", open);
  for (const tab of tabs) {
    tab.addEventListener("click", () => selectTab(tab.dataset.settingsTab ?? "profile"));
  }
  close.addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
  settingsTransferPace.addEventListener("change", () =>
    updateCanonicalSelect(dependencies.transferPace, settingsTransferPace.value));
  settingsRankingPreference.addEventListener("change", () =>
    updateCanonicalSelect(dependencies.rankingPreference, settingsRankingPreference.value));
  dependencies.transferPace.addEventListener("change", synchronizeJourneyPreferences);
  dependencies.rankingPreference.addEventListener("change", synchronizeJourneyPreferences);
}

function required<Element extends globalThis.Element>(
  root: ParentNode,
  selector: string,
): Element {
  const element = root.querySelector<Element>(selector);
  if (!element) throw new Error(`設定要素が見つかりません: ${selector}`);
  return element;
}
