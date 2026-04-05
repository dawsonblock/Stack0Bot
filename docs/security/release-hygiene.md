# Release Hygiene

## Packaging rules

- never ship source maps in release artifacts unless you explicitly intend to
- never embed archive URLs for source snapshots in distributable metadata
- audit `npmignore`, `package.json files`, and bundler sourcemap settings
- scan release artifacts for `.map`, `.zip`, `.tar`, `.tgz`, `.p12`, `.pem`, and `.env`

## Policy

This combined stack does not depend on leaked proprietary code. Keep that line hard. Use public APIs, public docs, and clean-room designs.
