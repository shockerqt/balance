# Daily 1.11.0 release — BAL-072

Status: verified APK available and basic operator phone smoke confirmed.
Native-baseline activation is prepared for final independent review and exact-head
CI; corrective OTA publication remains pending until the verified-main DAG records
its real delivery identities. The baseline becomes active through PR integration.

## Verified binary

- EAS Android internal build: `5ca199c6-3c88-4b13-9e1c-7ad73e2567f6`, `FINISHED` at `2026-11-13T18:37:10.711Z`.
- Actual built source: `2721894da17b4402ca3029888173bf52b07d94ea` (version PR #145).
- Profile `preview`, channel `daily`, package `com.balance.app.daily`.
- App version/runtime `1.11.0`, Android versionCode `14`.
- EAS fingerprint: `4f61b3639c63046bdcec4645570caf7f8cc0a72c`.
- Repo-pinned EAS CLI `21.7.0`; existing signing/profile and appVersion runtime policy retained.
- [Download APK](https://expo.dev/artifacts/eas/bkSDjM1Xayibt4EwdRvtH9__A80Jk1LCDPZ5T-EKpNU.apk).
- Downloaded bytes: `106201894`.
- APK SHA-256: `8e3a96f92375f5c6c8f47862d8c67faae96919287cfa3edf913f464287d9c76c`.
- Signing certificate SHA-256: `FCC0E60C7384A9BDE2FB856EC90E4601D5BE3700077351965A2257D66AF3C3FA`.

Binary inspection confirmed package/version/code, embedded runtime `1.11.0`,
updates enabled and the existing EAS project URL. Android apksigner verified the
APK v2 signature; its certificate matches public Daily assetlinks. Native DEX
contains ExpoHaptics. The seven registered font assets were found byte-identical
inside the APK. These checks establish binary identity, not phone behavior.
The operator was notified when the verified download became available.

## Compatible corrective source

The APK contains BAL-066/067/071/069 from the integrated feature base, including
fonts, compact diary/macros preference, quick-add dock/radial/weight sheet,
calorie target and optional haptics. It predates the following JavaScript fixes:

| Task | Correction | Integrated PR |
| --- | --- | --- |
| BAL-059 | Compact date typography/morph, row/group details, dock/radial geometry | #147 |
| BAL-067 | 16dp base bottom clearance; preserve conditional collapse runway | #148 |
| BAL-073 | Editorial weight readout/editing, ruler, delta and footer | #149 |
| BAL-060 | In-place selection and portion detail with retained hidden drafts | #150 |
| BAL-061 | Calendar spacing between irregular weight observations | #151 |

These corrections are integrated at `aaa285c979fa88c7a0034ced230760d176ec1e6e`.
Independent Terra plan/PR reviews and exact-head mobile/native CI passed;
51 combined focused component/gesture/summary tests and TypeScript passed.
This source and the actual built source have the same native contract:
`162f102bd6691103faf540b60018502eb5f0bfc0d70dea908500a5e7ae3e9259`.
No native configuration, dependency or font asset was changed by these fixes.
The proposed baseline deliberately records the actual built source, not the
later corrective source. The unchanged delivery gate must compare each new SHA
against that build before publication.

Inter600 approximates the browser reference's700 in the weight display;
see `docs/design/weight-sheet-fidelity.md`. Physical Android light/dark appearance,
keyboard/large-text layout, gestures, TalkBack and haptic behavior remain
unverified. The reported diary re-entry lag and initial hydration delay are not
claimed fixed by these visual corrections; BAL-056/053/057 retain that ownership.

## Phone observation and activation gate

Build, merge and OTA publication permission is already explicit. On 2026-11-13,
in response to the explicit question whether Daily `1.11.0 (14)` is installed and
login/session, record loading and saving work, the operator replied:
**«si funciona bien»**. This confirms the basic installed-version/session/data
smoke in that question's context and satisfies the activation prerequisite.
This is operator-reported evidence, not an agent-observed device test. No broader
visual, accessibility, haptic, logout or WSS-specific acceptance is inferred.
Final exact-head Terra review and CI remain mandatory before integration.

The operator previously reported visual differences and persistent lags after
receiving the APK link. That feedback is not successful visual/performance
acceptance and does not establish the installed version or login/data smoke.
Do not infer TalkBack, haptic or other physical acceptance from a basic smoke.

## Delivery evidence

Integrated corrective-source workflow [43507838082](https://github.com/shockerqt/balance/actions/runs/43507838082)
passed mobile, browser, dashboard and delivery-contract checks. Dashboard
publication succeeded and public `release.json` reported exact source
`aaa285c979fa88c7a0034ced230760d176ec1e6e`. Daily stopped with
`NEW_APK_REQUIRED` against the previous 1.9 baseline; it did not publish a
corrective update/group.

With basic phone validation confirmed, after final-head review, CI and merge, only the
existing `Deliver Balance Clients` DAG may publish/reconcile Android/preview/daily.
Verify the exact delivered SHA, runtime `1.11.0`, active daily-to-daily mapping,
update ID and group ID from Actions receipts and EAS. No successful publication,
OTA installation on a phone, or delivered corrective SHA is claimed by this pre-publication receipt.
Record real publication identities on issue #144 and linked delivery tasks.
A later receipt-only source PR must run its own delivery checks and cannot claim
an earlier OTA as the current source.

## Previous references

The previous main baseline, retained here as historical evidence, was Daily build
`7138388f-60fb-465f-8e4c-a8614e5d3c57`, source
`7210b6bbcf38aaf519c7e55f155c0b3a22a703bd`, runtime `1.9.0`, versionCode `12`,
fingerprint `24437b5856164ed3b75b38920b285d0bd4a2ee13`.
This identity remains historical evidence after the new baseline is activated.

EAS also has a finished 1.10.0/code13 APK (`26cf165e-1d3c-4cac-acfa-a03930f55ca6`,
source `39657a7c30e82a7764c5622659f2635d94d52bfd`), which predates the integrated
new gestures/preferences/haptics and is not the baseline proposed here.
