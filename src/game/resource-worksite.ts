/** Mine entrances face south. Keep simulation destinations and the artwork on
 * the same southernmost outcrop, using a stable centered choice for wide rows. */
export function southernResourceCell(cells: readonly number[], width: number): number | undefined {
    if (!cells.length) return undefined;
    const centerX = cells.reduce((sum, cell) => sum + cell % width, 0) / cells.length;
    let selected = cells[0];
    for (const cell of cells.slice(1)) {
        const row = Math.floor(cell / width), previousRow = Math.floor(selected / width);
        const offset = Math.abs(cell % width - centerX), previousOffset = Math.abs(selected % width - centerX);
        if (row > previousRow || row === previousRow && (offset < previousOffset || offset === previousOffset && cell < selected)) selected = cell;
    }
    return selected;
}
