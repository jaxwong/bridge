import { defineConfig } from 'wxt';

// Permission model: spec §4 (three tiers) and §5.3.
export default defineConfig({
  manifest: {
    name: 'BRIDGE',
    description: 'Makes inaccessible job application forms operable with your screen reader.',
    permissions: ['sidePanel', 'activeTab', 'scripting', 'storage'],
    host_permissions: [
      'https://*.myworkdayjobs.com/*',
      'https://boards.greenhouse.io/*',
      'https://job-boards.greenhouse.io/*',
      'https://jobs.lever.co/*',
      'https://jobs.ashbyhq.com/*',
      'https://*.vietnamworks.com/*',
      'https://www.linkedin.com/*',
      'http://localhost/*',
    ],
    optional_host_permissions: ['https://*/*'],
    action: { default_title: 'Open BRIDGE' },
    commands: {
      'open-bridge': {
        suggested_key: { default: 'Alt+Shift+B' },
        description: 'Open BRIDGE',
      },
      'focus-submit': {
        suggested_key: { default: 'Alt+Shift+S' },
        description: 'Check the answers, then move to Continue or Submit',
      },
    },
  },
});
