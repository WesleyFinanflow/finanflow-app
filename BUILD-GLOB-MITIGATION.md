# Build-tool mitigation — 2026-11-18

GHSA-fc5q-39xc-vjpf was updated on 2026-11-17 and currently has no patched npm release (picomatch <=4.0.7). Reference: https://github.com/advisories/GHSA-fc5q-39xc-vjpf.

Backend: removes development-only nodemon and uses Node 24's built-in --watch. This removes its picomatch 2 dependency. Production start is unchanged.

Frontend: picomatch 4.0.7 remains only in the Vite build/development toolchain. It is not imported by the browser app or the financial API. The project does not use extglobs. The committed pnpm patch refuses all extended glob patterns before matcher construction, parse and makeRe. Basic globstar/brace patterns remain supported. This is a temporary project-specific restriction, not a claim of an upstream general fix.

The CI audit exception names only this GHSA and runs only after a mandatory verification of the active Vite, tinyglobby and fdir dependency paths. A separate bounded test checks that mitigation. Every other advisory remains blocking. Unpatched audit output still reports this GHSA; it must not be described as fully resolved upstream. No broad ignore-unfixable or severity weakening is configured.

Tradeoff: build patterns using extglobs (for example +(a), !(a), @(a|b)) now fail explicitly. To remove the mitigation, first update to an upstream fixed version, then remove the patch, guard test and this exact audit exception together, and run the complete checks. Do not accept untrusted patterns in build tooling.
