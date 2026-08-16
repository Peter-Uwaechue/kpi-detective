# KPI Detective Validation Notes

## Live walkthrough findings

The dedicated `/kpi-detective` route renders as a polished upload experience with a clear hero, secure-data note, sample dataset action, four-stage progress rail, and responsive upload card. The initial server-rendering failure caused by browser-only session storage was corrected by guarding `sessionStorage` and `localStorage` access.

The built-in sample successfully reached the cleaning-summary stage. The review screen presented transparent logs for duplicate removal, date and numeric normalisation, category standardisation, invalid-value handling, and outlier flags. Identifier classification was then tightened so an ordinary order ID is not treated as a date; missing numeric values are now explicitly logged.

## Automated validation

`pnpm check` completed successfully after the KPI implementation. `pnpm build` completed successfully. The production build retains pre-existing warnings about unset analytics template variables and a large JavaScript chunk; neither warning blocks the build.

## Remaining walkthrough

The latest engine changes are ready to re-test through the sample-data investigation, dashboard, cleaned-data controls, and chat experience.

The refreshed sample-data run confirms that the revised cleaning engine no longer misclassifies `Order ID` as a date. The summary now reports 57 standardised dates, 56 standardised numeric values, one exact duplicate removed, one missing numeric value flagged, and two retained outlier flags. The review screen is visually stable and clearly communicates that no potentially duplicate record was auto-removed.

The first dashboard walkthrough verified the responsive KPI dashboard, trend chart, contribution chart, cause cards, local-history entry, and analyst prompt area. It also exposed a double-counted summary counterfactual when overlapping product and region drivers were added together. The engine was corrected to use the leading driver’s independently calculated counterfactual in the narrative. The sample outlier was moved to a prior period so it can remain visible for review without obscuring the intended current-month driver story.

The refined dashboard route renders successfully and displays the KPI hero, plain-English explanation, trend, contribution analysis, cause cards, local analysis history, and the data-aware chat interface. This walkthrough identified two presentational refinements: the hero percentage should retain the sign of a decline, and root-cause ranking should prioritise factors moving in the headline KPI’s direction rather than offsetting factors. The sample data will also be adjusted to make the intended Product/Region driver story clearer and reduce artificial customer churn.

A final fresh sample run reached the cleaning summary successfully after the root-cause ranking changes. The summary remains stable: duplicate removal, date and currency normalisation, category standardisation, missing-numeric flagging, and retained outlier review all work as intended.

The final live dashboard showed that equal contribution values need a deterministic presentation order. The engine now breaks true contribution ties in a decision-useful order—product, region, customer, then channel—while preserving impact as the primary ranking criterion. Type checking remains successful after this change.

Final dashboard verification passed. The sample produces a 4.6% revenue decline from $51,255 to $48,920, with **Product: Shirts** and **Region: East Coast** shown first as the tied primary drivers. The narrative, contribution chart, cause cards, counterfactual ($52,365), confidence score (96%), and decline indicator are internally consistent and visually correct.

The final chat validation passed. The suggested prompt, “Why did Shirts change?”, returned an immediate data-grounded explanation stating that Product: Shirts contributed a $3,445 decline between May and June 2026, with a calculated 96% confidence score. The local deterministic answer continues to work even when the optional server-side model service is unavailable.
