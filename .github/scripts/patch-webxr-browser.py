from pathlib import Path
import sys

path = Path(sys.argv[1] if len(sys.argv) > 1 else "_site/Build/ArApp 2.framework.js")
text = path.read_text(encoding="utf-8")
changed = False

# Newer Unity/Emscripten removed global Browser; WebXR Export needs MainLoop.
old_browser = "Module['WebXR'].GetBrowserObject = function () {\n  return Browser;\n}"
new_browser = (
    "Module['WebXR'].GetBrowserObject = function () {\n"
    "  if (typeof Browser !== 'undefined' && Browser.mainLoop) {\n"
    "    return Browser;\n"
    "  }\n"
    "  MainLoop.mainLoop = MainLoop;\n"
    "  return MainLoop;\n"
    "}"
)

if "MainLoop.mainLoop = MainLoop" in text:
    print("WebXR Browser patch already present")
elif old_browser not in text:
    raise SystemExit("Could not find GetBrowserObject stub to patch")
else:
    text = text.replace(old_browser, new_browser, 1)
    changed = True
    print("Patched GetBrowserObject for MainLoop")

# Guard animate until requestReferenceSpace resolves. Without this, the patched
# requestAnimationFrame can call getViewerPose(undefined) and crash AR startup.
old_animate = (
    "      XRManager.prototype.animate = function (frame) {\n"
    "        var session = frame.session;\n"
    "        if (!session) {\n"
    "          return this.didNotifyUnity;\n"
    "        }"
)
new_animate = (
    "      XRManager.prototype.animate = function (frame) {\n"
    "        var session = frame.session;\n"
    "        if (!session) {\n"
    "          return this.didNotifyUnity;\n"
    "        }\n"
    "        if (!session.refSpace) {\n"
    "          return this.didNotifyUnity;\n"
    "        }"
)

if "if (!session.refSpace)" in text:
    print("WebXR refSpace guard already present")
elif old_animate not in text:
    raise SystemExit("Could not find XRManager.animate stub to patch")
else:
    text = text.replace(old_animate, new_animate, 1)
    changed = True
    print("Patched XRManager.animate refSpace guard")

if changed:
    path.write_text(text, encoding="utf-8")
