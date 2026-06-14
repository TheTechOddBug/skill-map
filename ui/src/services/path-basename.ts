/**
 * Path → friendly basename for display.
 *
 * Trigger → path resolution used to live here too, but it now happens
 * once in the kernel (the post-walk lift stamps `link.resolvedTarget`)
 * and rides along in the API payload, so the UI reads that field
 * instead of recomputing a name index. What remains is this pure
 * display helper, used by the node card and the files view to label a
 * node when `frontmatter.name` is absent.
 */

/**
 * Path → friendly basename used as the node-card / files-view display
 * name when `frontmatter.name` is absent. Conventions:
 *
 *   - `<dir>/<name>/SKILL.md`  → `<name>`
 *   - `<dir>/<name>.md`        → `<name>`
 *   - bare path with no slash  → path stripped of `.md`
 *
 * Pure helper, no Angular deps.
 */
export function pathBasenameForLink(path: string): string {
  const segments = path.split('/').filter((s) => s.length > 0);
  if (segments.length === 0) return path;
  const last = segments[segments.length - 1]!;
  if (last === 'SKILL.md' && segments.length >= 2) {
    return segments[segments.length - 2]!;
  }
  return last.replace(/\.md$/, '');
}
