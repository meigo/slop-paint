import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "warn",
      "no-constant-condition": "warn",
      "prefer-const": "warn",
    },
  },
  {
    // Build-time Node script (icon generation): the two Node globals it uses.
    files: ["tools/**/*.mjs"],
    languageOptions: { globals: { Buffer: "readonly", console: "readonly" } },
  },
  // Disable rules that conflict with Prettier (must be after the rule configs).
  prettier,
  {
    ignores: ["dist/", "**/*.svelte"],
  },
);
