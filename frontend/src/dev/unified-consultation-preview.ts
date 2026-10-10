import "../presentation/styles/viewer.css";
import { createTrip } from "@raiquora/trip/trip";
import { configureAiFirstShell } from "../presentation/home/ai-first-shell";
import { configureConsultationScreen } from "../presentation/home/consultation-screen";
import { configureTripWorkspace } from "../presentation/trip-plan/trip-workspace";
import { createTripWorkspaceController } from "../usecases/trip-plan/trip-workspace-controller";

/** Imported only by the local browser verifier's HTML document. No production
 * entrypoint, server API, model, real account, persistence or credentials. */
if (!import.meta.env.DEV) throw new Error("Development-only consultation fixture");
const app = document.createElement("main"); app.id = "app"; document.body.append(app);
const panel = document.createElement("section"); panel.id = "ai-guide-panel"; panel.className = "ai-guide-panel";
const messages = document.createElement("ol"); messages.id = "ai-guide-messages";
const form = document.createElement("form"), input = document.createElement("input"), submit = document.createElement("button");
input.type = "text"; input.setAttribute("aria-label", "相談内容"); submit.type = "submit";
form.append(input, submit); panel.append(messages, form); app.append(panel);
const trip = createTrip("74200000-0000-4000-8000-000000000001", "出雲旅行（表示検証用）", "2026-09-27T00:00:00Z", [
  { id: "sight", type: "activity", title: "出雲大社", category: "sightseeing", schedule: { type: "unscheduled" } },
  { id: "stay", type: "stay", title: "宿泊地は検討中", selection: { status: "unselected" }, schedule: { type: "unscheduled" } },
]);
const controller = createTripWorkspaceController("new-fixture");
const listeners = new Set<() => void>();
const notify = () => { for (const listener of listeners) listener(); };
const append = (role: "user" | "assistant", text: string) => {
  const item = document.createElement("li"); item.className = `ai-guide-message ai-guide-message-${role}`; item.textContent = text; messages.append(item);
};
let sequence = 0, submissions = 0;
let workspace: ReturnType<typeof configureTripWorkspace>;
function reset() { controller.activateSession(`new-fixture-${++sequence}`); messages.replaceChildren(); input.value = ""; notify(); }
function openTrip(view: "trip" | "chat") {
  controller.attach("trip-fixture", { getCurrentTrip: () => trip }); controller.activateSession("trip-fixture");
  messages.replaceChildren(); append("user", "この旅の予定を相談したいです。"); append("assistant", "この旅程について相談できます。これは画面検証用の固定表示です。");
  workspace.show(view); notify();
}
const shell = configureAiFirstShell(document, app, {
  read: () => ({ state: "available", trips: [trip] }), authState: () => ({ status: "signed-in", displayName: "表示検証" }),
  login: () => undefined, logout: () => undefined, retry: async () => undefined,
  subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  resetConsultation: reset,
  newConsultation: async prompt => {
    submissions++; document.body.dataset.submissions = String(submissions);
    await Promise.resolve(); append("user", prompt); append("assistant", "目的地の紹介をここに表示します。これは接続先を持たない画面検証用のサンプルです。");
  },
  openChat: () => { panel.hidden = false; if (controller.current()) workspace.show("chat"); },
  openTrip: () => openTrip("trip"), consultTrip: async () => { openTrip("chat"); },
  openMap: () => undefined,
  journeySettings: () => ({ transferPace: "standard", rankingPreference: "balanced" }), setJourneySettings: () => undefined,
  openNotifications: () => undefined, now: () => new Date("2026-09-27T00:00:00Z"),
});
workspace = configureTripWorkspace({ app, chat: panel, messages, input, controller,
  showContext: () => undefined, returnToConversation: () => undefined, showMap: () => undefined,
  ask: prompt => append("user", prompt), nextItemId: () => crypto.randomUUID(),
  onViewChange: view => view === "trip" ? shell.showTrip(trip.id) : shell.showConversation(controller.current()?.id),
});
configureConsultationScreen(panel, messages, form, input, {
  read: () => ({ sessionId: controller.sessionId(), trip: controller.current() }), profile: () => undefined,
  subscribe: listener => { const unsubscribe = controller.subscribe(listener); listeners.add(listener); return () => { unsubscribe(); listeners.delete(listener); }; },
  save: proposal => controller.saveConditions(proposal), showTrip: () => workspace.show("trip"), newConversation: () => shell.navigate("chat"),
});
form.addEventListener("submit", event => { event.preventDefault(); if (input.value.trim()) { append("user", input.value.trim()); input.value = ""; } });
document.body.dataset.consultationPreview = "ready";
