import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // agent worktrees live inside the repo and carry their own copy of the tests
    exclude: [...configDefaults.exclude, '.claude/**'],
  },
});
