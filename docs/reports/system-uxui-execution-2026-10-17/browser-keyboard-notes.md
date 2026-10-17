# WebKit keyboard behavior observed in this environment

The initial settings test assumed a pointer click focuses a button, then expected
Escape from the account dialog to restore focus to that button. WebKit on this
Mac does not focus buttons on pointer click. The verified focus-return scenario
explicitly focuses the edit button and opens it with Enter before Escape.

A second assumption expected ArrowRight on a focusable overflow region to scroll
in WebKit. A minimal standalone page (no application code) reproduced:

| Engine | ArrowRight after focusing a 200px scroll region | Two Tab presses | Two Alt+Tab presses |
| --- | --- | --- | --- |
| Chromium | scrollLeft 40 | Last button focused, scrollLeft 700 | Not used |
| WebKit | scrollLeft 0 | Buttons skipped, scrollLeft 0 | Last button focused, scrollLeft 700 |

The final WebKit table scenario uses Alt+Tab to reach the first row's delete
button and asserts focus plus horizontal scroll. Chromium retains ArrowRight.
This matches the observed native keyboard preference; no application keyboard
handler was added to override browser behavior. Headless WebKit is not a
substitute for testing Safari on a physical iPhone.
