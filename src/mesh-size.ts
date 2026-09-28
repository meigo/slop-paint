/**
 * Mesh warp density (pure). A mesh starts at 3×3 (2×2 is Distort) and can be made finer while
 * warping; the engine resamples the grid (bilinear over the old cells), so going UP carries the
 * bends over — a sharp bend softens a little where no new point lands on the dragged one. Going
 * down would average bends away, so it is only offered while the grid is still untouched.
 */
export const MESH_MIN = 3;
export const MESH_MAX = 8;

/** Why the mesh can't step `dir` from `size`, or "" when it can. */
export function meshStepBlock(size: number, dir: 1 | -1, untouched: boolean): string {
  if (dir > 0) return size >= MESH_MAX ? `${MESH_MAX}×${MESH_MAX} is the finest` : "";
  if (size <= MESH_MIN) return `${MESH_MIN}×${MESH_MIN} is the coarsest (2×2 is Distort)`;
  return untouched ? "" : "only before you bend it — fewer points would lose the bends";
}

/** Whether `grid` still lies exactly where `start` put it (nothing dragged yet). */
export function gridUntouched(
  grid: { x: number; y: number }[][],
  start: { x: number; y: number }[][],
  eps = 1e-6,
): boolean {
  if (grid.length !== start.length) return false;
  return grid.every(
    (row, r) =>
      row.length === start[r].length &&
      row.every(
        (p, c) => Math.abs(p.x - start[r][c].x) <= eps && Math.abs(p.y - start[r][c].y) <= eps,
      ),
  );
}
