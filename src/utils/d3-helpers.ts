const EXPERT_GRID_COLS = 8;
const EXPERT_GRID_ROWS = 8;

interface Point {
  x: number;
  y: number;
}

interface ExpertNodeLayout extends Point {
  id: number;
  col: number;
  row: number;
}

interface RouterDiagramLayout {
  router: Point;
  routerRadius: number;
  experts: ExpertNodeLayout[];
  expertIdleRadius: number;
  expertSelectedRadius: number;
}

interface LayoutOptions {
  width: number;
  height: number;
  leftPadding?: number;
  rightPadding?: number;
  topPadding?: number;
  bottomPadding?: number;
  routerGap?: number;
  routerRadius?: number;
  expertIdleRadius?: number;
  expertSelectedRadius?: number;
  /** Grid shape. Defaults to OLMoE's 8×8 = 64; JetMoE passes a smaller grid (2×4 = 8 experts). */
  gridRows?: number;
  gridCols?: number;
}

/** Positions the router node at 9 o'clock (left, vertically centered) and the experts in a
 *  gridRows×gridCols grid trending toward 3 o'clock, so the routing trajectory reads left-to-right.
 *  Defaults to OLMoE's 8×8 (64 experts); JetMoE overrides the grid for its 8-expert routers. */
export function computeRouterDiagramLayout({
  width,
  height,
  leftPadding = 40,
  rightPadding = 32,
  topPadding = 24,
  bottomPadding = 24,
  routerGap = 70,
  routerRadius = 30,
  expertIdleRadius = 10,
  expertSelectedRadius = 17,
  gridRows = EXPERT_GRID_ROWS,
  gridCols = EXPERT_GRID_COLS,
}: LayoutOptions): RouterDiagramLayout {
  const router: Point = { x: leftPadding + routerRadius, y: height / 2 };

  const gridLeft = router.x + routerGap;
  const gridWidth = width - rightPadding - gridLeft;
  const gridHeight = height - topPadding - bottomPadding;

  let colStep = gridRows > 1 ? gridWidth / (gridRows - 1) : 0;
  let rowStep = gridCols > 1 ? gridHeight / (gridCols - 1) : 0;

  // Stretching both axes to fill the frame only reads as a grid when there are enough of them.
  // With a small count one axis has a single gap that swallows the whole dimension — JetMoE's 8
  // experts put ~350px between two rows against 156px between columns, which looks distorted
  // rather than wide. Cap each step against the other so the lattice stays near-square, then
  // centre the block in whatever room that leaves. OLMoE's 8×8 is already 66.9 × 50.3 (ratio 1.33),
  // so the cap is a no-op there and its layout is untouched.
  const MAX_CELL_ASPECT = 1.35;
  if (colStep > 0 && rowStep > 0) {
    colStep = Math.min(colStep, rowStep * MAX_CELL_ASPECT);
    rowStep = Math.min(rowStep, colStep * MAX_CELL_ASPECT);
  }
  const xOffset = (gridWidth - (gridRows - 1) * colStep) / 2;
  const yOffset = (gridHeight - (gridCols - 1) * rowStep) / 2;

  const experts: ExpertNodeLayout[] = [];
  for (let row = 0; row < gridRows; row++) {
    for (let col = 0; col < gridCols; col++) {
      experts.push({
        id: row * gridCols + col,
        row,
        col,
        x: gridLeft + xOffset + row * colStep,
        y: topPadding + yOffset + col * rowStep,
      });
    }
  }

  return {
    router,
    routerRadius,
    experts,
    expertIdleRadius,
    expertSelectedRadius,
  };
}

/** A gentle horizontal curve from the router rightward to an expert node. */
export function edgePath(from: Point, to: Point): string {
  const midX = from.x + (to.x - from.x) * 0.5;
  return `M ${from.x} ${from.y} C ${midX} ${from.y}, ${midX} ${to.y}, ${to.x} ${to.y}`;
}
