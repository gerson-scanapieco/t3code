import type * as Electron from "electron";

let setBlurRadiusPromise: Promise<(windowNumber: number, radius: number) => number> | undefined;

// Electron's vibrancy materials have a fixed blur; the private CoreGraphics call takes a radius.
function loadSetBlurRadius() {
  setBlurRadiusPromise ??= import("ffi-rs").then(({ DataType, load, open }) => {
    const library = "t3-core-graphics";
    open({ library, path: "/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics" });
    const connection = load({
      library,
      funcName: "CGSMainConnectionID",
      retType: DataType.I32,
      paramsType: [],
      paramsValue: [],
    });
    return (windowNumber: number, radius: number) =>
      load({
        library,
        funcName: "CGSSetWindowBackgroundBlurRadius",
        retType: DataType.I32,
        paramsType: [DataType.I32, DataType.I32, DataType.I32],
        paramsValue: [connection, windowNumber, radius],
      });
  });
  return setBlurRadiusPromise;
}

/** The media source id is `window:<CGWindowID>:0` on macOS. */
function parseMacWindowNumber(mediaSourceId: string): number | null {
  const match = /^window:(\d+):/.exec(mediaSourceId);
  return match ? Number(match[1]) : null;
}

export async function setMacWindowBlurRadius(
  window: Electron.BrowserWindow,
  radius: number,
): Promise<void> {
  const setBlurRadius = await loadSetBlurRadius();
  if (window.isDestroyed()) return;
  const windowNumber = parseMacWindowNumber(window.getMediaSourceId());
  if (windowNumber === null) throw new Error("The window has no macOS window number.");
  const error = setBlurRadius(windowNumber, radius);
  if (error !== 0) throw new Error(`CGSSetWindowBackgroundBlurRadius failed with ${error}.`);
}
