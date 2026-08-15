# Nutrition precision policy

Balance keeps nutrition calculations and synchronized snapshots as finite
floating-point numbers without rounding intermediate results. Rounding belongs
to an explicit output boundary so repeated scaling and aggregation do not lose
information.

## Mobile presentation

- Energy is displayed as whole kilocalories.
- Protein, carbohydrates, fat and fiber are displayed with at most one decimal
  gram, using the Chilean decimal separator and no trailing zero.
- Editable nutrition fields expose at most six decimal places. Parsing accepts
  both comma and point, and saved values remain numeric.
- Accessibility labels reuse the same formatted values shown on screen.
- Daily and hourly totals are calculated from raw values and formatted after
  aggregation. They are not obtained by summing individually rounded rows.

## Persistence and synchronization

Meal templates, nutrition snapshots and synchronization payloads retain their
validated numeric precision. Balance does not rewrite stored data merely to
match a display rule.

## MCP output

MCP item nutrition and daily totals are numeric JSON values normalized to at
most six decimal places. This removes binary floating-point artifacts while
retaining precision for milligram and extended-nutrition values. The server
continues to calculate and persist with the original `f64` values.
