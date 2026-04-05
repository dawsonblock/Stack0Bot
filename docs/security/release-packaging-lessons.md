# Release Packaging Lessons

The combined stack excludes leaked or mirrored Claude Code source from the core artifact.

## Required checks before shipping

- Fail the build if any `.map` file is present.
- Fail the build if release bundles include debug zips, transient logs, or backups.
- Fail the build if obvious secrets are embedded in the tree.
- Review CDN, remote storage, and public bucket exposure separately from npm packaging.

Use `scripts/release-scan.sh` as a preflight and CI gate, not as an advisory tool.
