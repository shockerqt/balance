# Daily 1.11.0 release — BAL-072

Status: version preparation. No 1.11.0 APK, phone acceptance or OTA publication is claimed yet.

## Intended binary

- Android internal distribution, EAS profile `preview`, channel `daily`.
- Package `com.balance.app.daily`, version/runtime `1.11.0`, versionCode `14`.
- Repo-pinned EAS CLI `21.7.0`; existing signing/profile and appVersion runtime policy retained.
- Integrated feature base: `238ff55c16f297a420e25f5e6f7297ee43f49315` (BAL-066/067/071/069).
- Includes the new font assets, compact diary/macros preference, quick-add dock/radial/weight sheet, calorie target and optional haptic feedback.

## Authorization and verification gates

The operator explicitly authorized continuing the task pipeline, builds, merges and OTA publications, and requested notification when the APK can be downloaded and when OTA delivery is ready.

Build from a clean, integrated, verified source. Record the real EAS build ID/source/runtime/code/fingerprint, APK URL and checksum when available. Verify package/version/signing and native haptic inputs before notifying download availability.

Phone validation is pending. Per `docs/native-daily-log.md`, an APK and compile checks do not establish physical acceptance. Record the actual operator result before activating the new native baseline. Do not invent successful login, touch, TalkBack or haptic observations.

After verification, update `delivery/daily-runtime.json` in a separately reviewed PR. Only the existing verified-main `Deliver Balance Clients` DAG may publish/reconcile OTA. Record exact update/group/source/runtime and channel evidence here. No local OTA publication or compatibility-gate bypass.

## Previous reference

The currently recorded Daily baseline is build `7138388f-60fb-465f-8e4c-a8614e5d3c57`, source `7210b6bbcf38aaf519c7e55f155c0b3a22a703bd`, runtime `1.9.0`, versionCode `12`, EAS fingerprint `24437b5856164ed3b75b38920b285d0bd4a2ee13`.

EAS also has a finished 1.10.0/code13 APK (`26cf165e-1d3c-4cac-acfa-a03930f55ca6`, source `39657a7c30e82a7764c5622659f2635d94d52bfd`), which predates the latest integrated gestures/preferences/haptics and is not the baseline being activated.

## Outstanding evidence

- Version PR and exact-source checks.
- Finished EAS 1.11.0 build, APK verification and download notification.
- Actual operator phone validation.
- Reviewed baseline activation and verified Daily OTA publication.
