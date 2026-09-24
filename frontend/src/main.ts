import "./presentation/styles/viewer.css";
import { startAuthentication } from "./composition/auth-composition";

// Complete and scrub the OAuth callback before Viewer modules can make requests.
await startAuthentication();
const { startViewer } = await import("./composition/viewer-composition");
startViewer();
