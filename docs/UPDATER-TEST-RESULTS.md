# Updater prototype verification — 2026-10-27

Environment: Linux cloud workspace, Python 3.12.14, cryptography 50.0.0, Node 24.22.1.

## Passed
- Python `unittest discover -s tests -p test_updater.py`: 23 tests.
- Existing Node mock/static `tests/unit.cjs`: 41 tests (configuration assertions updated for intentional optional updater).
- New `tests/updater.cjs`: 16 mocked worker/popup tests.
- Node syntax checks for new scripts, Python compilation, `git diff --check`.
- Independent static review followed by fixes/regressions for post-commit cleanup,
  bounded reads, lock growth, incompatible manifests, and committed update reload
  despite failure to persist cosmetic status.

Tests include fixture signing/tamper/wrong key/expiry, repository/channel binding,
rollback/replay prevention, hash, ZIP traversal/links/duplicates, filesystem lock,
rename failure rollback, journal recovery, protocol/origin, URL bounds, opt-in/denial,
popup-only access, host missing, reload retry protection, and existing setting retention.

## Failed
None in the final executed suites. Initial intentional old permission expectation and
review findings were corrected before rerunning the final suites.

## Not run / not proven
Windows executable build, native host launch/registration, real Chrome/Edge permission
UI, popup layout, extension reload/actual storage persistence, open-tab reinjection,
Windows locked files/ACL/antivirus, install/uninstall, live Google, real signed release
network round trip, production signing/key custody, dependency hash-locked packaging,
production performance, and power-loss recovery. Linux simulations are not Windows QA.

## Publication and safety
Source originated from the user's original ZIP; actual Git main base was verified as
8812f4324dbc5748847105621c09a8d2a01eb5f6. No original ZIP, published release, remote branch,
main, registry, browser, site, or account setting was changed. Trust defaults empty and
no production signing key was generated. Prototype cannot auto-update until reviewed
bootstrap/prerequisites described in NATIVE-UPDATES.md are completed separately.
