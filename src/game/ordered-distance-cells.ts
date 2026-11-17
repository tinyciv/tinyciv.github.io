interface OrderedCells {
  heap: Uint32Array;
  remaining: number;
  prefix: number[];
}
const orders = new WeakMap<Float32Array, OrderedCells>();

/** Travel fields are immutable. Build their distance/index ordering only as
 * far as callers consume it: relocation usually finds a nearby plot and never
 * needs the rest of the world sorted. Independent iterators replay the shared
 * prefix and can extend it in any interleaving without changing that order. */
export function* orderedDistanceCells(distances: Float32Array): Generator<number> {
  let order = orders.get(distances);
  const precedes = (a: number, b: number): boolean => {
    const difference = distances[a] - distances[b];
    // Infinity minus Infinity is NaN; the former Array.sort comparator uses
    // the cell ID for that tie, just as for equal finite distances.
    return difference ? difference < 0 : a < b;
  };
  const descend = (heap: Uint32Array, remaining: number, index: number, cell: number): void => {
    while (index * 2 + 1 < remaining) {
      let child = index * 2 + 1;
      if (child + 1 < remaining && precedes(heap[child + 1], heap[child])) child++;
      if (!precedes(heap[child], cell)) break;
      heap[index] = heap[child]; index = child;
    }
    heap[index] = cell;
  };
  if (!order) {
    const heap = new Uint32Array(distances.length);
    for (let cell = 0; cell < heap.length; cell++) heap[cell] = cell;
    for (let index = Math.floor(heap.length / 2) - 1; index >= 0; index--) descend(heap, heap.length, index, heap[index]);
    order = { heap, remaining: heap.length, prefix: [] };
    orders.set(distances, order);
  }
  for (let index = 0; ; index++) {
    if (index === order.prefix.length) {
      if (!order.remaining) return;
      const cell = order.heap[0], last = order.heap[--order.remaining];
      if (order.remaining) descend(order.heap, order.remaining, 0, last);
      order.prefix.push(cell);
    }
    yield order.prefix[index];
  }
}
