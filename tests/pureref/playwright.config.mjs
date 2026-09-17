import { defineConfig } from '@playwright/test';
export default defineConfig({
	testDir: '.',
	testMatch: '*.spec.mjs',
	workers: 1,
	outputDir: '../../test-results',
	use: {
		browserName: 'chromium',
		channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
		viewport: { width: 1280, height: 900 },
		baseURL: 'http://127.0.0.1:4173',
		screenshot: 'only-on-failure',
	},
	webServer: {
		command: 'node scripts/pureref-preview.mjs',
		url: 'http://127.0.0.1:4173',
		reuseExistingServer: !process.env.CI,
		cwd: '../..',
	},
});
