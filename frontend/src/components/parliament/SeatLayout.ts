export type SeatLayoutPoint = {
    id: string;
    x: number;
    y: number;
    row: number;
    col: number;
};

export type SeatLayoutOptions = {
    /** Center X (SVG units). Default matches the demo (400 in an 800-wide viewBox). */
    centerX?: number;
    /** Center Y (SVG units). Default matches the demo (420 in a 450-tall viewBox). */
    centerY?: number;
    /** Inner radius (SVG units). */
    minRadius?: number;
    /** Outer radius (SVG units). */
    maxRadius?: number;
    /** Angle span in radians (π = 180° hemicycle). */
    angleSpan?: number;
    /** Search range for inter-seat spacing (SVG units). */
    spacingMin?: number;
    spacingMax?: number;
    /** Max iterations for spacing search. */
    maxIterations?: number;
};

function clamp(n: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, n));
}

type Position = { x: number; y: number; angle: number; row: number; col: number };

function countSeatsWithSpacing(
    angleSpan: number,
    minRadius: number,
    maxRadius: number,
    spacing: number
): number {
    let count = 0;
    const availableRadialSpace = maxRadius - minRadius;
    const rows = Math.floor(availableRadialSpace / spacing) + 1;

    for (let row = 0; row < rows; row += 1) {
        const radius = minRadius + row * spacing;
        if (radius > maxRadius) break;
        const angularSpacing = spacing / Math.max(1, radius);
        const seatsInRow = Math.floor(angleSpan / angularSpacing) + 1;
        count += seatsInRow;
    }

    return count;
}

function generatePositions(
    totalSeats: number,
    centerX: number,
    centerY: number,
    angleSpan: number,
    minRadius: number,
    maxRadius: number,
    spacing: number
): Position[] {
    const positions: Position[] = [];
    const availableRadialSpace = maxRadius - minRadius;
    const rows = Math.floor(availableRadialSpace / spacing) + 1;

    for (let row = 0; row < rows; row += 1) {
        const radius = minRadius + row * spacing;
        if (radius > maxRadius) break;

        const angularSpacing = spacing / Math.max(1, radius);
        const seatsInRow = Math.floor(angleSpan / angularSpacing) + 1;
        const actualAngleStep = seatsInRow > 1 ? angleSpan / (seatsInRow - 1) : angleSpan;

        for (let col = 0; col < seatsInRow; col += 1) {
            const angle = Math.PI + col * actualAngleStep;
            const x = centerX + radius * Math.cos(angle);
            const y = centerY + radius * Math.sin(angle);

            positions.push({ x, y, angle, row, col });
            if (positions.length >= totalSeats) break;
        }

        if (positions.length >= totalSeats) break;
    }

    // Sort left-to-right across the hemicycle.
    positions.sort((a, b) => a.angle - b.angle);
    return positions.slice(0, totalSeats);
}

/**
 * Compute a hemicycle (half-circle) seat layout.
 *
 * Demo-style generator:
 * - Concentric semicircle rows from minRadius..maxRadius.
 * - Uses a spacing search (binary search) to approximately fit the requested seat count.
 * - Positions are sorted left-to-right so the consumer can assign parties in order.
 */
export function computeHemicycleLayout(
    seatCount: number,
    width: number,
    height: number,
    options?: SeatLayoutOptions
): SeatLayoutPoint[] {
    const centerX = options?.centerX ?? width / 2;
    const centerY = options?.centerY ?? height - 30;
    const minRadius = options?.minRadius ?? Math.max(60, Math.min(width, height) * 0.2);
    const maxRadius = options?.maxRadius ?? Math.max(0, Math.min(width / 2 - 30, height - 30));
    const angleSpan = options?.angleSpan ?? Math.PI;
    const spacingMin = options?.spacingMin ?? 8;
    const spacingMax = options?.spacingMax ?? 15;
    const maxIterations = options?.maxIterations ?? 50;

    let low = spacingMin;
    let high = spacingMax;
    let best = (low + high) / 2;

    for (let i = 0; i < maxIterations; i += 1) {
        const mid = (low + high) / 2;
        const count = countSeatsWithSpacing(angleSpan, minRadius, maxRadius, mid);
        best = mid;

        if (count > seatCount) {
            // Too many seats → increase spacing.
            low = mid;
        } else if (count < seatCount) {
            // Too few seats → decrease spacing.
            high = mid;
        } else {
            break;
        }

        if (Math.abs(high - low) < 0.001) break;
    }

    const positions = generatePositions(seatCount, centerX, centerY, angleSpan, minRadius, maxRadius, best);

    return positions.map((pos, idx) => ({
        id: `seat-${idx}`,
        x: pos.x,
        y: pos.y,
        row: pos.row,
        col: pos.col,
    }));
}

export type HemicycleLayoutResult = {
    points: SeatLayoutPoint[];
    dotRadius: number;
};

/**
 * Convenience wrapper that returns both point positions and a suggested dot radius.
 *
 * The dot radius is derived from the layout constraints and stays stable for a
 * given (seatCount, width, height, options).
 */
export function computeHemicycleLayoutWithRadius(
    seatCount: number,
    width: number,
    height: number,
    options?: SeatLayoutOptions
): HemicycleLayoutResult {
    const spacingMin = options?.spacingMin ?? 8;
    const spacingMax = options?.spacingMax ?? 15;
    const maxIterations = options?.maxIterations ?? 50;
    const centerX = options?.centerX ?? width / 2;
    const centerY = options?.centerY ?? height - 30;
    const minRadius = options?.minRadius ?? Math.max(60, Math.min(width, height) * 0.2);
    const maxRadius = options?.maxRadius ?? Math.max(0, Math.min(width / 2 - 30, height - 30));
    const angleSpan = options?.angleSpan ?? Math.PI;

    let low = spacingMin;
    let high = spacingMax;
    let best = (low + high) / 2;

    for (let i = 0; i < maxIterations; i += 1) {
        const mid = (low + high) / 2;
        const count = countSeatsWithSpacing(angleSpan, minRadius, maxRadius, mid);
        best = mid;
        if (count > seatCount) low = mid;
        else if (count < seatCount) high = mid;
        else break;
        if (Math.abs(high - low) < 0.001) break;
    }

    const points = computeHemicycleLayout(seatCount, width, height, {
        ...options,
        centerX,
        centerY,
        minRadius,
        maxRadius,
        angleSpan,
        spacingMin,
        spacingMax,
        maxIterations,
    });

    // Match the demo’s visual proportions: base dot radius around ~4.5.
    const dotRadius = clamp(best * 0.42, 3.6, 5.2);

    return { points, dotRadius };
}
