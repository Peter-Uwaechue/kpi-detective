# Category Alias-Resolution Research Notes

## Evidence-based principles

The Unicode Consortium explains that normalization can make canonically or compatibility-equivalent text forms comparable, while cautioning that compatibility folding should not be applied blindly because it can erase meaningful distinctions. The ICU documentation likewise describes normalization as converting equivalent text to a unique form. For business-category fields, this supports Unicode normalization, case folding, whitespace normalization, and controlled punctuation folding before comparison.[1][2]

Categorical data-cleaning guidance recommends a layered approach: inspect values, standardize basic formatting first, use direct mappings for certain aliases or synonyms, and reserve fuzzy matching for minor differences such as typographical errors. It also stresses that fuzzy matching is not a substitute for domain knowledge and should be documented and reviewable.[3]

## Realistic category variation catalogue

| Pattern | Examples | Safe automated treatment |
|---|---|---|
| Leading/trailing or non-breaking whitespace | ` Abuja`, `Abuja ` | Trim and collapse all Unicode whitespace. |
| Case variation | `ABUJA`, `abuja` | Unicode case-fold for matching; preserve a readable canonical display form. |
| Terminal and decorative punctuation | `Abuja.`, `Abuja,`, `Abuja!` | Remove terminal punctuation for the match key. |
| Internal punctuation and separators | `Port-Harcourt`, `Port Harcourt`, `Port_Harcourt` | Convert compatible separators to a single space for the match key. |
| Apostrophe/quote variants | `O’Connor`, `O'Connor` | Fold typographic apostrophes to a plain apostrophe for matching. |
| Diacritics and Unicode composition | `São Paulo`, `Sao Paulo`, composed/decomposed `é` | NFKD plus combining-mark removal for the comparison key; retain a preferred display label. |
| Full-width / compatibility characters | `Ａｂｕｊａ`, circled/full-width characters | NFKC before other matching transforms. |
| Abbreviations and known aliases | `PH`, `P.H.`, `Port Harcourt`; `NY`, `New York` | Only controlled, scoped dictionaries or user-reviewed mappings; do not infer arbitrary acronym expansions. |
| Minor typos | `Abjua`, `Port Harcout` | High-threshold fuzzy candidate only, with guardrails and review trail. |
| Transliterations and language variants | `München`, `Munich`; `Wrocław`, `Wroclaw` | Diacritic folding is safe; semantic translations require a controlled alias map or review. |
| Semantic synonyms | `Web`, `Online`, `Website` | Controlled alias maps only; never auto-merge solely from string distance. |
| Corporate/legal suffixes | `Acme Ltd`, `Acme Limited` | Do not remove generically for all categories; only use a company-specific canonicalisation policy. |
| Distinct values that look similar | `Congo` vs `DR Congo`, `Niger` vs `Nigeria`, `San Jose` vs `San José` where distinct entities may exist | Never merge by formatting normalisation alone; require exact normalized keys, explicit map, or high-confidence review. |

## Planned implementation posture

1. Deterministic formatting normalization resolves equivalence such as `Abuja.` and `abuja` before fuzzy matching.
2. Controlled per-domain alias maps may cover established geographic/business aliases, with each change written to the review audit trail.
3. Fuzzy matching remains conservative, is limited to category-like fields, and is blocked for short values, acronym-only values, and ambiguous nearest matches.
4. Every automatic reconciliation retains the original raw value and an auditable change entry; uncertain relationships remain separate for user review.

## References

[1]: https://unicode.org/reports/tr15/ "Unicode Standard Annex #15: Unicode Normalization Forms"
[2]: https://unicode-org.github.io/icu/userguide/transforms/normalization/ "ICU Documentation: Normalization"
[3]: https://paths.grasp.study/public-courses/caf3eb31-1ef8-4d6d-8078-e83730a5abf5/modules/ad0bc595-d251-4b0e-835b-0ea024448bda/lessons/5256072e-9122-4bce-9d89-418346ef50f2 "Standardizing Categorical Data"
