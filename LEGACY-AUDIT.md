# Read-only legacy diagnosis

Manual workflow only; never imports application startup, seeds, indexes or migration routines. Uses the native MongoDB driver through the existing mongoose dependency and only aggregate/find queries with majority read concern and per-query time limits. Tests assert query command names and unchanged fixture documents.

Checks top-level space/user/account/coupon references and ambiguous paid plan origins, inconsistent trial/courtesy metadata and subscription reconciliation candidates. Missing creators can be legitimate when a partner left a shared space. Findings are review candidates, not instructions to delete, convert or revoke access. Sequential reads are not a global snapshot; recheck before any later change. Nested historical snapshots are outside scope.

The repository is public. Reports contain limited identifiers and access enums, never selected names/emails, password material, tokens or financial values. No report data or driver error details are printed to Actions logs. Report is encrypted with a fresh AES-256-GCM key, wrapped using an RSA-OAEP-SHA256 recipient public key (minimum 3072 bits). Only public PEM is passed to Actions; the reviewer keeps the private key locally. Artifact retention is seven days. No application deployment or database writes are needed.

Run CI before merging, generate a local recipient key pair, manually dispatch legacy-audit.yml with recipient_public_key, download encrypted artifact and decrypt locally. Do not store private keys in the repository or chat. Findings require owner review before any migration/cleanup; this workflow has no mutation mode.
