import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'wxt';

const source = new URL('../instagram-fluxo/', import.meta.url);
const { manifest_version: manifestVersion, ...manifest } = JSON.parse(readFileSync(new URL('manifest.json', source), 'utf8'));

// The unpacked extension also contains local development artifacts. Include only runtime
// and documentation files in the build, and leave queue-machine.js to the WXT entrypoint.
const packagedFiles = [
  'DESIGN.md',
  'LEIA-ME.md',
  'PRODUCT.md',
  'action-pacing.js',
  'agent-policy.js',
  'assets/brand-sources.json',
  'assets/fonts/LICENSE.txt',
  'assets/fonts/inter-display-light.woff2',
  'assets/fonts/inter-medium.woff2',
  'assets/fonts/inter-regular.woff2',
  'assisted-unfollow.js',
  'background.js',
  'brand-motion.js',
  'brand.css',
  'dashboard-workspace.js',
  'dashboard.css',
  'dashboard.html',
  'dashboard.js',
  'diagnostic-client.js',
  'diagnostic-contract.json',
  'diagnostic-log.js',
  'diagnostic-schema.js',
  'discovery.js',
  'icons/reminder.png',
  'icons/upaiva-16.png',
  'icons/upaiva-180.png',
  'icons/upaiva-192.png',
  'icons/upaiva-32.png',
  'icons/upaiva-48.png',
  'icons/upaiva-512.png',
  'icons/upaiva-favicon.ico',
  'icons/upaiva-favicon.svg',
  'instagram.js',
  'local-database.js',
  'local-storage-details.js',
  'meta-insights.css',
  'meta-insights.html',
  'meta-insights.js',
  'native-host/host.py',
  'native-host/install.ps1',
  'native-host/read_logs.py',
  'notification-settings.js',
  'profile-cleaner-inventory.js',
  'profile-cleaner-panel.js',
  'profile-cleaner-store.js',
  'profile-photo-client.js',
  'profile-photos.js',
  'provider-vault.js',
  'queue-notifications.js',
  'queue-reminders.js',
  'queue-view.css',
  'queue-view.js',
  'side-panel-link.js',
  'sidepanel.css',
  'sidepanel.html',
  'sidepanel.js',
  'stop-shortcut.js',
  'unfollow-all.js',
  'vendor/dexie.LICENSE.txt',
  'vendor/dexie.min.js',
  'vendor/dexie.source.json',
  'workflow-backup-panel.js',
  'workflow-backup.js',
];

export default defineConfig({
  browser: 'chrome',
  manifestVersion,
  manifest,
  imports: false,
  zip: {
    artifactTemplate: 'instagram-fluxo-v{{version}}.zip',
    zipSources: false,
  },
  hooks: {
    'build:publicAssets': (_wxt, files) => {
      files.splice(0, files.length, ...packagedFiles.map(relativeDest => ({
        absoluteSrc: fileURLToPath(new URL(relativeDest, source)),
        relativeDest,
      })), {
        absoluteSrc: fileURLToPath(new URL('./node_modules/xstate/LICENSE', import.meta.url)),
        relativeDest: 'vendor/xstate.LICENSE.txt',
      });
    },
  },
});
