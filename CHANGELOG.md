# Changelog

This file is the short, human-edited source for GitHub Release notes. Keep entries user-facing and concise; do not paste the full commit history here.

## 0.1.0 - Unreleased

### Highlights

- Introduce the first SemVer release line for Renewlet.
- Publish Docker images through stable and release-candidate tags.
- Add a version-pinned Docker deployment package to each GitHub Release.

### Upgrade Notes

- Production Docker deployments should pin a concrete version tag such as `0.1.0`.
- `latest` only moves on stable releases; release candidates use `rc` tags.
