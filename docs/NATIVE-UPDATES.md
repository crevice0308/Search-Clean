# GitHub-only native updater — development prototype / 開発試作

**Not installed, not release-ready, and disabled by default.** This is real update code,
not only a release notification. It deliberately fails closed until the publisher key,
verified unpacked extension IDs and managed bootstrap directory are configured.
既存 v1.0.0-preview.1 と配布 ZIP は変更しません。現在の公開版に自動更新機能が
追加されたわけではありません。PC へのインストール・登録は別途承認が必要です。

## Flow / 動作

An opt-in popup requests optional `nativeMessaging` permission. A browser-running daily
alarm, startup, or explicit check calls `com.searchclean.updater`. No system service,
scheduled task, remote JS, enterprise browser policy, login flow, or browser-security
change is used. `storage` preserves the existing enabled setting; `alarms` is the one
additional persistent permission. Native access is optional. The extension never sends
an arbitrary URL, path or shell command to the host. Only its own popup may request work.

The host downloads `update.json` from the **stable** latest release of
`crevice0308/Search-Clean`, verifies an independently pinned Ed25519 publisher key,
then downloads the fixed `Search-Clean-extension.zip` asset from the signed version tag.
HTTPS redirects are restricted to GitHub and GitHub's release asset host; reads have
socket timeouts, a total read deadline and size limits. ZIP SHA-256 is signed, not merely
obtained from the same unauthenticated release. Sequence plus numeric version reject
rollback/replays; metadata expires within 31 days. A publisher must refresh expired
metadata, even if there is no new version. Same-version metadata returns current only
when sequence and version match locally.

Only `extension/` regular files with conservative Windows-safe paths are extracted.
Traversal, case collisions, symlinks/reparse points, devices, encrypted ZIPs and size
excesses are rejected. The native helper and trust configuration are **not** self-updated.
The helper is stored outside the managed extension directory.

Update uses an OS-held exclusive lock and sibling staging/backup directories. A journal
rolls back interrupted uncommitted updates on the next invocation. Directory renames
are atomic individually; the whole two-rename replacement is **not** atomic, and a
brief missing-directory interval exists. Windows locked-file failures roll back where
possible. If rollback also fails, the journal is retained and the call fails closed for
manual recovery. Local browser profile/storage is never copied, cleared or replaced.
After a successful update the extension calls `runtime.reload()`; already-open Google
tabs may need refresh. Reload/Windows filesystem behavior still requires real QA.

## Trust/bootstrap prerequisites (not performed)

1. Publisher chooses signing/key custody process separately; no production private key
   is included or generated. Pin the reviewed 32-byte Ed25519 public key in `updater.py`.
   Test keys are ephemeral, test-only, never trusted by the shipped helper.
2. Review a Windows Python 3 + cryptography deployment or frozen `SearchCleanHost.exe`,
   including dependency wheel hashes, provenance, antivirus and signing. The requirement
   pin is for the tested development environment, not a secure production lockfile.
   This source does not yet produce a validated Windows executable/installer.
3. Create a fixed user-owned, ACL-reviewed helper directory, with `managed/extension/`
   holding the unpacked extension and `managed/state.json` containing its verified
   `{"sequence": 0, "version": "1.0.0"}` baseline (adjust only for the actual baseline).
   Keep this directory's path stable: unpacked IDs depend on installation identity.
4. Verify each Chrome/Edge extension ID, pin exact IDs in `EXTENSION_IDS`, and create the
   native-host manifest from the inert template with matching `allowed_origins`.
   Register only after separate user approval. No installer/registry changes are run here.
5. User enables optional update permission/checkbox. Test Chrome and Edge separately.

The host trusts same-user local files; it does not defend against an already compromised
Windows account. Filesystem preflight rejects links but is not a race-proof sandbox
against another same-user process changing directories. TLS + signatures do not solve
publisher key compromise. Key rotation and helper upgrades require reviewed bootstrap.

## Signed release format

`update.json` envelope has exactly `signed` and base64 `signature`. Sign UTF-8/ASCII bytes
of Python `json.dumps(signed, sort_keys=True, separators=(',', ':'), ensure_ascii=True)`.
No executable signing utility or secret workflow is created by this prototype.

```json
{"schema":1,"repo":"crevice0308/Search-Clean","channel":"stable","sequence":2,"version":"1.1.0","tag":"v1.1.0","asset":"Search-Clean-extension.zip","size":12345,"sha256":"<64 lowercase hexadecimal characters>","expires":1800003600}
```

The ZIP contains only `extension/<files>` (no directory entries). It must include the
complete extension, including updater worker; manifest name stays `Search Clean Lite`
and numeric version matches metadata. Unsigned existing preview ZIPs are never accepted.
Metadata publishes only with a stable release; existing preview release stays untouched.

## Tests / 検証

```
python -m unittest discover -s tests -p 'test_updater.py' -v
node tests/unit.cjs
node tests/updater.cjs
```

Tests use temporary synthetic directories, ephemeral signing keys, stub network/native
messaging and simulated filesystem failures. They do not access or change the real browser.

**Not run:** Windows host launch/registration, Windows ACL/AV/locked-file recovery,
Chrome/Edge actual unpacked reload/storage persistence, live Google rendering, installer
install/uninstall, signed release downloads, production dependency packaging or signing.
No browser, registry, website, release, or production configuration is changed.

References: [Chrome runtime](https://developer.chrome.com/docs/extensions/reference/api/runtime),
[Edge native messaging](https://learn.microsoft.com/en-us/microsoft-edge/extensions/developer-guide/native-messaging),
[Chrome distribution](https://developer.chrome.com/docs/extensions/how-to/distribute).

Disabling automatic updates prevents future calls; it does not cancel a native update already in flight. Manifest identity, permissions, injection rules and declared resources must remain compatible; capability changes require manual review/bootstrap. Crash recovery is tested at the process level, not power-loss durability.
