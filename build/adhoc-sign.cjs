// electron-builder afterPack hook (macOS): re-sign the finished PlanDesk.app ad hoc.
//
// Releases are unsigned (no Apple Developer ID yet), so electron-builder skips signing. The
// bundle then keeps only the stock Electron binary's linker signature, which no longer matches
// the packaged app ("code has no resources but signature indicates they must be present").
// A downloaded app with a broken signature is reported by macOS as "PlanDesk is damaged and
// can't be opened" (issue #1). An ad-hoc signature over the whole bundle is valid, so macOS
// instead shows the normal unidentified-developer prompt that "Open Anyway" gets past.
// Real fix later: a Developer ID certificate + notarization (then remove this hook).
const { execFileSync } = require("node:child_process");
const path = require("node:path");

exports.default = async function adhocSign(context) {
  if (context.electronPlatformName !== "darwin") return;
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  console.log(`  • ad-hoc signing ${app}`);
  execFileSync("codesign", ["--force", "--deep", "--sign", "-", app], { stdio: "inherit" });
  execFileSync("codesign", ["--verify", "--deep", "--strict", "--verbose=2", app], { stdio: "inherit" });
};
