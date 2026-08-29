import type { StreetGraph } from "../graph/graphStore.js";
import { haversineMeters } from "../graph/graphStore.js";

interface HeapItem {
  nodeId: number;
  priority: number;
}

class MinHeap {
  private items: HeapItem[] = [];

  push(item: HeapItem): void {
    this.items.push(item);
    let i = this.items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.items[parent].priority <= this.items[i].priority) break;
      [this.items[parent], this.items[i]] = [this.items[i], this.items[parent]];
      i = parent;
    }
  }

  pop(): HeapItem | undefined {
    if (this.items.length === 0) return undefined;
    const top = this.items[0];
    const last = this.items.pop()!;
    if (this.items.length > 0) {
      this.items[0] = last;
      let i = 0;
      const n = this.items.length;
      for (;;) {
        const left = 2 * i + 1;
        const right = 2 * i + 2;
        let smallest = i;
        if (left < n && this.items[left].priority < this.items[smallest].priority) smallest = left;
        if (right < n && this.items[right].priority < this.items[smallest].priority) smallest = right;
        if (smallest === i) break;
        [this.items[i], this.items[smallest]] = [this.items[smallest], this.items[i]];
        i = smallest;
      }
    }
    return top;
  }

  get size(): number {
    return this.items.length;
  }
}

export interface AStarResult {
  nodeIds: number[];
  totalCost: number;
  totalDistance_m: number;
}

/** costFn receives the edge's plain distance and its lon/lat midpoint; returns the weighted cost for A*. */
export function astar(
  graph: StreetGraph,
  startId: number,
  goalId: number,
  costFn: (distance_m: number, midLon: number, midLat: number) => number
): AStarResult | undefined {
  const goal = graph.nodeCoords.get(goalId);
  if (!goal) return undefined;

  const gScore = new Map<number, number>([[startId, 0]]);
  const distScore = new Map<number, number>([[startId, 0]]);
  const cameFrom = new Map<number, number>();
  const visited = new Set<number>();

  const heuristic = (nodeId: number): number => {
    const c = graph.nodeCoords.get(nodeId);
    if (!c) return 0;
    return haversineMeters(c.lon, c.lat, goal.lon, goal.lat);
  };

  const open = new MinHeap();
  open.push({ nodeId: startId, priority: heuristic(startId) });

  while (open.size > 0) {
    const current = open.pop()!;
    if (visited.has(current.nodeId)) continue;
    visited.add(current.nodeId);

    if (current.nodeId === goalId) {
      const nodeIds: number[] = [goalId];
      let cursor = goalId;
      while (cameFrom.has(cursor)) {
        cursor = cameFrom.get(cursor)!;
        nodeIds.push(cursor);
      }
      nodeIds.reverse();
      return {
        nodeIds,
        totalCost: gScore.get(goalId) ?? 0,
        totalDistance_m: distScore.get(goalId) ?? 0,
      };
    }

    const edges = graph.adjacency.get(current.nodeId) ?? [];
    for (const edge of edges) {
      if (visited.has(edge.to)) continue;
      const tentativeG = (gScore.get(current.nodeId) ?? Infinity) + costFn(edge.distance_m, edge.midLon, edge.midLat);
      if (tentativeG < (gScore.get(edge.to) ?? Infinity)) {
        gScore.set(edge.to, tentativeG);
        distScore.set(edge.to, (distScore.get(current.nodeId) ?? 0) + edge.distance_m);
        cameFrom.set(edge.to, current.nodeId);
        open.push({ nodeId: edge.to, priority: tentativeG + heuristic(edge.to) });
      }
    }
  }

  return undefined;
}
