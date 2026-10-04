import "./presentation/styles/viewer.css";
import { startApplication } from "./composition/start-application";
import { installIosInputZoomPrevention } from "./presentation/shared/ios-input-zoom";

installIosInputZoomPrevention(document, navigator);

// Let the entry module finish before the lazy Viewer imports shared entry exports.
void startApplication();
