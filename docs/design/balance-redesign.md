# Balance redesign (2026-11-12)

Approved reference: <https://sandbox.shocker.cl/m/balance-clean-redesign>
(ui-design-sandbox `src/mockups/BalanceCleanRedesign.tsx`, UDS-018/UDS-019).
It replaces the Organic direction: the Bosque, Laguna, Lavanda and Durazno
palettes, their gradients and the colour picker were removed in BAL-058.
Settings keeps **Modo** (Sistema / Claro / Oscuro).

Scope: the Android app (Daily). iOS and react-native-web screens only inherit
the tokens. Tasks: BAL-058 tokens and primitives, BAL-059 diary, BAL-060 add
food, BAL-061 summary.

## Tokens

Source of truth in code: `apps/mobile/src/theme/palettes.ts`.

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| ground | `#F7F7F5` | `#101113` | Screen background |
| surface | `#FFFFFF` | `#1A1C20` | Cards, bars, inputs |
| ink | `#16181D` | `#ECEDEA` | Text, primary buttons, selected day, calorie meter |
| onInk | `#FFFFFF` | `#101113` | Text and icons on ink |
| ink2 | `#5A606B` | `#A3A8B1` | Secondary text |
| line | `#E4E5E1` | `#2A2D33` | Card borders |
| lineStrong | `#D5D7D2` | `#5A606B` | Control borders |
| track | `#ECEDE9` | `#2A2D33` | Meter tracks, row dividers, logged day |
| protein | `#2F5BEA` | `#7DA0FF` | Protein meter, weight line |
| carbs | `#B97A00` | `#E3AC3A` | Carbohydrate meter |
| fat | `#C2336B` | `#F27AA6` | Fat meter |
| bar | `#8A8F99` | `#6E747F` | Past days in charts |
| barEmpty | `#D5D7D2` | `#3A3E46` | Days without records |
| goal | `#9CA1AA` | `#8A8F99` | Dashed goal line |
| link / focus | `#2F5BEA` | `#8FB0FF` | Links, focus ring |
| danger | `#B42318` | `#FF8A80` | Errors, over target (always with text) |

`tests/balance-theme.test.mjs` checks 4.5:1 for text roles and 3:1 for
meters and chart bars on ground and surface in both schemes.

Macro colours always appear next to their name and value. No gradients.

## Type

| Variant | Family | Size | Use |
| --- | --- | --- | --- |
| display | Bricolage Grotesque Bold, opsz 30 | 30 | Screen title |
| title | Bricolage Grotesque Bold, opsz 22 | 22 | Sheet title |
| numberLarge | Bricolage Grotesque Bold, opsz 40 | 40 | Day calories |
| numberMedium | Bricolage Grotesque Bold, opsz 30 | 32 | Summary figures |
| hour | Bricolage Grotesque SemiBold, opsz 16 | 16 | Meal hour, day number (17) |
| heading | Inter SemiBold | 15 | Card titles, button labels |
| body / bodyStrong | Inter Regular / Medium | 15 | Text, food names |
| caption | Inter Regular | 13 | Secondary text |
| label | Inter Medium | 12 | Smallest text (macro names, tab labels) |
| number | Inter SemiBold, tabular | 15 | Calories in rows |

The mockup uses the variable Bricolage Grotesque with automatic optical
sizing. React Native cannot vary `opsz`, so `assets/fonts/` carries static
instances at the sizes the design renders, generated from Bricolage
Grotesque 1.001 (OFL, `BricolageGrotesque-OFL.txt`) with fontTools
`varLib.instancer` (wdth 100) and a Latin subset. Each file is one weight:
styles using these families must not set `fontWeight`, or Android adds a
synthetic bold.

Radius: cards 20, list cards and inputs 16, controls 14, chips 999. Touch
targets at least 44 px.

## Delivery

New font assets change the Daily native fingerprint, so the merge of BAL-058
makes Daily delivery stop with `NEW_APK_REQUIRED`
(`scripts/delivery/native-compatibility.mjs`). The app version moved to
1.10.0 / versionCode 13 so OTAs for the new runtime never reach 1.9.0
installs. Build and verify the 1.10.0 APK, then update
`delivery/daily-runtime.json` in a reviewed PR (docs/eas-daily-use.md).
