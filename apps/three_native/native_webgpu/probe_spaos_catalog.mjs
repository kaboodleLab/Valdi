import path from 'node:path';
import { existsSync } from 'node:fs';
import { AppCatalog } from '@spaos/app-catalog';
import { InstalledAppSource } from '@spaos/installed-apps';
import { appDirs, scanAppManifests } from '@spaos/app-manifests';
import { resolveAppRoot } from '@spaos/app-roots';
import { dataDirs, dataHome, loadDenylist, scanApplications } from '@spaos/desktop-entries';
import { packageManagerClientPaths } from '@spaos/package-manager-client';

export async function scanHostApps(desktopRoot) {
  const denied = await loadDenylist(desktopRoot);
  return { host: await scanApplications(denied), deniedCount: denied.size };
}

// Read-only headless probe for the next Shell controller. Import SPAOS's
// receipt and catalog code directly; do not duplicate its launch rules here.
export async function probeSpaosCatalog({ desktopRoot, electronBinary, instanceName,
  report = () => {} }) {
  const layout = resolveAppRoot(desktopRoot);
  const root = layout?.appRoot ?? null;
  const slug = process.env.SPAOS_PRODUCT_SLUG || 'spaos';
  const dirs = appDirs(root, dataHome(), slug, dataDirs());
  const generatedRunner = root ? path.join(dirs[0], 'shared', 'generated-app-main.js') : null;
  const generatedLauncher = root ? path.join(root, 'capabilities', 'generated-apps',
    'launcher.mjs') : null;
  const requestedSandbox = process.env.SPAOS_GENERATED_APP_BWRAP || '/usr/bin/bwrap';
  const generatedSandbox = process.platform === 'linux' && existsSync(requestedSandbox)
    ? requestedSandbox : null;
  const installed = new InstalledAppSource({
    loadPresentations: () => scanAppManifests(dirs, electronBinary, report,
      generatedRunner, generatedSandbox, generatedLauncher),
    configuration: () => packageManagerClientPaths(instanceName),
    report,
  });
  const catalog = new AppCatalog(() => installed.load(), report);
  const [snapshot, { host, deniedCount }] = await Promise.all([
    catalog.refresh(), scanHostApps(desktopRoot),
  ]);
  return { catalog, snapshot, host, deniedCount, layout: layout?.layout ?? null };
}

if (process.argv[1]?.endsWith('probe_spaos_catalog.cjs')) {
  const [desktopRoot, electronBinary, instanceName] = process.argv.slice(2);
  if (!desktopRoot || !electronBinary || !instanceName ||
      !path.isAbsolute(desktopRoot) || !path.isAbsolute(electronBinary)) {
    process.stderr.write('usage: node probe_spaos_catalog.cjs DESKTOP_ROOT ELECTRON_BINARY INSTANCE\n');
    process.exitCode = 2;
  } else {
    probeSpaosCatalog({ desktopRoot, electronBinary, instanceName,
      report: message => process.stderr.write(`[catalog] ${message}\n`) })
      .then(({ snapshot, host, deniedCount, layout }) => {
        process.stdout.write(JSON.stringify({
          generation: snapshot.generation,
          worldApps: snapshot.apps.map(entry => entry.id),
          hostApps: host.map(entry => entry.id),
          deniedCount,
          verbReservations: snapshot.verbOwners.length,
          layout,
        }) + '\n');
      })
      .catch(error => {
        process.stderr.write(`[catalog] ${String(error?.stack || error)}\n`);
        process.exitCode = 1;
      });
  }
}
