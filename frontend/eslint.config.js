import globals from "globals";
import react from "eslint-plugin-react";
export default [
  { ignores: ["dist/**", "node_modules/**"] },
  { files: ["**/*.{js,jsx}"], languageOptions: { ecmaVersion: "latest", sourceType: "module", globals: { ...globals.browser, ...globals.node }, parserOptions: { ecmaFeatures: { jsx: true } } }, plugins: { react }, rules: { "no-undef": "error", "no-dupe-args": "error", "no-dupe-keys": "error", "no-unreachable": "error", "valid-typeof": "error", "react/jsx-uses-vars": "error", "react/jsx-uses-react": "error" } },
  { files: ["src/DebtPlan.jsx"], rules: { "no-unused-vars": ["error", { argsIgnorePattern: "^_" }] } },
];
