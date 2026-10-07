import { defineConfig } from 'vite';

// GitHub Pages serves project sites from /<repo>/, so relative base is required
// for the built asset URLs. Dev server is unaffected.
export default defineConfig({
  base: process.env.GITHUB_ACTIONS ? '/ManualCAD/' : '/',
});
