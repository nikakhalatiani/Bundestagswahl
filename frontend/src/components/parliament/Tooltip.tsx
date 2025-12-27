export type TooltipContent = {
    title: string;
    lines: string[];
};

type Props = {
    open: boolean;
    x: number;
    y: number;
    content: TooltipContent | null;
};

/**
 * In-SVG tooltip (rect + text) that follows the cursor in SVG coordinates.
 * This matches the provided demo design and avoids layout jitter when the SVG scales.
 */
export function Tooltip({ open, x, y, content }: Props) {
    if (!open || !content) return null;

    const width = 240;
    const height = 74;
    const offsetX = 12;
    const offsetY = -70;

    const boxX = x + offsetX;
    const boxY = y + offsetY;

    return (
        <g>
            <rect
                x={boxX}
                y={boxY}
                width={width}
                height={height}
                rx={6}
                fill="var(--bg-primary)"
                stroke="var(--border-color)"
                strokeWidth={1}
            />
            <text x={boxX + 12} y={boxY + 26} style={{ fontSize: 14, fill: 'var(--text-primary)', fontWeight: 700 }}>
                {content.title}
            </text>
            {content.lines.slice(0, 2).map((line, idx) => (
                <text
                    key={idx}
                    x={boxX + 12}
                    y={boxY + 46 + idx * 16}
                    style={{ fontSize: 12, fill: 'var(--text-secondary)' }}
                >
                    {line}
                </text>
            ))}
        </g>
    );
}
