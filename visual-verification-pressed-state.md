# Pressed-state verification

The service carousel and vacancy list were verified at 375x812 and 1280x720. The touch-only `:has(...:active)` rules add a brief scale-down and shadow change during a tap, while the desktop hover presentation remains unchanged. Mobile screenshots show no layout shift, clipping, or reduced tap clarity. The reduced-motion override removes transform and shadow animation for visitors who request reduced motion.

Automated verification passed with 40 test files and 66 tests, followed by a successful production build.
