import { MAX_WINDOW_OPACITY } from "@t3tools/contracts/settings";

import { isElectron } from "~/env";

import { isMacPlatform } from "./utils";

/** Only the macOS desktop window has the native blur that shows through a translucent page. */
export const supportsWindowOpacity =
  isElectron && typeof navigator !== "undefined" && isMacPlatform(navigator.platform);

export function isWindowTranslucent(windowOpacity: number): boolean {
  return supportsWindowOpacity && windowOpacity < MAX_WINDOW_OPACITY;
}
