import { startAuthentication } from "./auth-composition";
import { showStartupFailure } from "../presentation/shared/startup-status";

export async function startApplication(
  authenticate: () => Promise<unknown> = startAuthentication,
  loadViewer: () => Promise<{ startViewer(): Promise<void> }> = () => import("./viewer-composition"),
  document: Document = window.document,
  reload: () => void = () => window.location.reload(),
): Promise<void> {
  try {
    // Scrub the OAuth callback before Viewer modules can make requests.
    await authenticate();
    const { startViewer } = await loadViewer();
    await startViewer();
    document.getElementById("startup-status")?.remove();
  } catch {
    // Provider/URL/token details must never appear in startup errors.
    showStartupFailure(document, reload);
  }
}
