import "./presentation/styles/viewer.css";
import { startAuthentication } from "./composition/auth-composition";
import { installIosInputZoomPrevention } from "./presentation/shared/ios-input-zoom";

installIosInputZoomPrevention(document, navigator);

// Complete and scrub the OAuth callback before Viewer modules can make requests.
await startAuthentication();
const { startViewer } = await import("./composition/viewer-composition");
startViewer();
