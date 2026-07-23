/**
 * User-facing strings emitted by the built-in `github/enrichment`
 * Action. The `detail` field of its report persists into
 * `state_enrichments.data_json` and surfaces to operators (CLI / UI
 * enrichment panels), so every wording lives in this catalog per the
 * i18n convention (`context/kernel.md` §i18n strategy).
 *
 * Convention: flat string templates with `{{name}}` placeholders. The
 * `tx` helper at `kernel/util/tx.ts` does the interpolation.
 */

export const GITHUB_ENRICHMENT_TEXTS = {
  /** `source` annotation missing / not a string (defensive; the dispatcher gates first). */
  detailMissingAnnotations:
    'Node carries no usable `source` / `sourceVersion` annotations to verify against.',
  /** `source` did not parse as a GitHub file URL. */
  detailUnparseableSource:
    'Could not parse `source` as a GitHub file URL (expected github.com/<owner>/<repo>/[blob/<ref>/]<path>): {{source}}',
  /** The ref-resolution API call failed with a non-OK HTTP status. */
  detailRefResolveFailed:
    'Could not resolve ref {{ref}} via the GitHub API: HTTP {{status}}.',
  /** The ref-resolution API call hit the rate limit. */
  detailRateLimited:
    'GitHub API rate limit exceeded while resolving ref {{ref}} (HTTP {{status}}). Configure the `token` setting on github/enrichment to raise the limit.',
  /** The API response did not carry a usable commit SHA. */
  detailRefNoSha:
    'GitHub API response for ref {{ref}} carried no commit SHA.',
  /** The raw-content fetch failed with a non-OK HTTP status. */
  detailRawFetchStatus:
    'Raw content fetch responded HTTP {{status}} for {{url}}.',
  /** A fetch threw (network failure, DNS, abort). */
  detailFetchError:
    'Fetch failed for {{url}}: {{message}}',
  /** Hashes disagree: the local body drifted from the pinned upstream. */
  detailBodyMismatch:
    'Local body hash does not match the upstream content at the pinned version.',
} as const;
