from pathlib import Path
import sys

path = Path(sys.argv[1] if len(sys.argv) > 1 else "_site/Build/ArApp 2.framework.js")
text = path.read_text(encoding="utf-8")

old = "Module['WebXR'].GetBrowserObject = function () {\n  return Browser;\n}"
new = (
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
elif old not in text:
    raise SystemExit("Could not find GetBrowserObject stub to patch")
else:
    path.write_text(text.replace(old, new, 1), encoding="utf-8")
    print("Patched GetBrowserObject for MainLoop")
