import "./presentation/styles/viewer.css";
import { startApplication } from "./composition/start-application";
import { installIosInputZoomPrevention } from "./presentation/shared/ios-input-zoom";

installIosInputZoomPrevention(document, navigator);

await startApplication();
