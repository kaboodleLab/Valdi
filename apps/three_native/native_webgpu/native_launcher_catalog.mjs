// SPAOS supplies the authenticated rows; these flags only choose the visual
// band. WorldOS's catalogLayout owns the spacing between the bands.
export function launcherBand(app) {
  if (app.spaosWorldOs) return 1;
  if (app.spaosNative || app.world === false) return 2;
  return 0;
}

export function sortLauncherApps(apps) {
  return [...apps].sort((a, b) => launcherBand(a) - launcherBand(b) ||
    (a.name || a.key).localeCompare(b.name || b.key));
}
