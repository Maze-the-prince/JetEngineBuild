from pathlib import Path
import sys

path = Path(sys.argv[1] if len(sys.argv) > 1 else "_site/Build/ArApp 2.framework.js")
text = path.read_text(encoding="utf-8")
changed = False


def apply(old: str, new: str, already: str, label: str) -> None:
    global text, changed
    if already in text:
        print(f"{label}: already present")
        return
    if old not in text:
        raise SystemExit(f"{label}: could not find stub to patch")
    text = text.replace(old, new, 1)
    changed = True
    print(f"{label}: patched")


# 1) Unity 6 often creates HEAPF32 locally but does not expose Module.HEAPF32.
# WebXR Export writes Module.HEAPF32[...] and crashes onEndSession / animate.
apply(
    'HEAPF32=new Float32Array(b);Module["HEAPF64"]=HEAPF64=new Float64Array(b);',
    'Module["HEAPF32"]=HEAPF32=new Float32Array(b);Module["HEAPF64"]=HEAPF64=new Float64Array(b);',
    'Module["HEAPF32"]=HEAPF32=new Float32Array(b)',
    "HEAPF32 Module export",
)

# 2) Prefer real MainLoop inside any Unity-6 Browser shim injected into the build.
apply(
    """  function resolveMainLoop() {
    if (typeof Module !== 'undefined') {
      if (Module.mainLoop) return Module.mainLoop;
      if (Module.Browser && Module.Browser.mainLoop) return Module.Browser.mainLoop;
      if (Module.canvas && Module.canvas.mainLoop) return Module.canvas.mainLoop;
    }
    if (typeof Browser !== 'undefined' && Browser && Browser.mainLoop) {
      return Browser.mainLoop;
    }""",
    """  function resolveMainLoop() {
    if (typeof MainLoop !== 'undefined' && MainLoop) {
      return MainLoop;
    }
    if (typeof Module !== 'undefined') {
      if (Module.mainLoop) return Module.mainLoop;
      if (Module.Browser && Module.Browser.mainLoop) return Module.Browser.mainLoop;
      if (Module.canvas && Module.canvas.mainLoop) return Module.canvas.mainLoop;
    }
    if (typeof Browser !== 'undefined' && Browser && Browser.mainLoop) {
      return Browser.mainLoop;
    }""",
    "typeof MainLoop !== 'undefined' && MainLoop",
    "Browser shim MainLoop resolve",
)

# 3) Older builds still have GetBrowserObject -> Browser.
apply(
    "Module['WebXR'].GetBrowserObject = function () {\n  return Browser;\n}",
    (
        "Module['WebXR'].GetBrowserObject = function () {\n"
        "  if (typeof Browser !== 'undefined' && Browser.mainLoop) {\n"
        "    return Browser;\n"
        "  }\n"
        "  MainLoop.mainLoop = MainLoop;\n"
        "  return MainLoop;\n"
        "}"
    ),
    "MainLoop.mainLoop = MainLoop",
    "GetBrowserObject MainLoop fallback",
)

# 4) Guard animate until reference space exists.
apply(
    (
        "      XRManager.prototype.animate = function (frame) {\n"
        "        var session = frame.session;\n"
        "        if (!session) {\n"
        "          return this.didNotifyUnity;\n"
        "        }"
    ),
    (
        "      XRManager.prototype.animate = function (frame) {\n"
        "        var session = frame.session;\n"
        "        if (!session) {\n"
        "          return this.didNotifyUnity;\n"
        "        }\n"
        "        if (!session.refSpace) {\n"
        "          return this.didNotifyUnity;\n"
        "        }"
    ),
    "if (!session.refSpace)",
    "animate refSpace guard",
)

# 5) Guard onEndSession heap writes if shared arrays are not ready.
apply(
    (
        "        this.removeRemainingTouches();\n"
        "        this.touchEventQueue.length = 0;\n"
        "\n"
        "        Module.HEAPF32[this.xrData.controllerA.frameIndex] = -1; // XRControllerData.frame"
    ),
    (
        "        this.removeRemainingTouches();\n"
        "        this.touchEventQueue.length = 0;\n"
        "\n"
        "        if (Module.HEAPF32 && this.xrData.controllerA.frameIndex != null) {\n"
        "        Module.HEAPF32[this.xrData.controllerA.frameIndex] = -1; // XRControllerData.frame"
    ),
    "if (Module.HEAPF32 && this.xrData.controllerA.frameIndex != null)",
    "onEndSession HEAP guard open",
)

# Close the HEAP guard block before OnEndXR call.
apply(
    (
        "        Module.HEAPF32[this.xrData.handRight.enabledIndex] = 0; // XRHandData.enabled\n"
        "\n"
        "        this.gameModule.WebXR.OnEndXR();"
    ),
    (
        "        Module.HEAPF32[this.xrData.handRight.enabledIndex] = 0; // XRHandData.enabled\n"
        "        }\n"
        "\n"
        "        this.gameModule.WebXR.OnEndXR();"
    ),
    "XRHandData.enabled\n        }\n\n        this.gameModule.WebXR.OnEndXR",
    "onEndSession HEAP guard close",
)

if changed:
    path.write_text(text, encoding="utf-8")
    print("Wrote", path)
else:
    print("No changes needed")
