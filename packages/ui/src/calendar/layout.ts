/** Reparte eventos solapados en carriles (columnas internas) estilo Google Calendar. */
export interface LaneItem {
  id: string;
  start: number;
  end: number;
}
export interface LanePos {
  lane: number;
  lanes: number;
}

export function computeLanes(items: LaneItem[]): Map<string, LanePos> {
  const sorted = [...items].sort((a, b) => a.start - b.start || b.end - a.end);
  const out = new Map<string, LanePos>();
  let cluster: { item: LaneItem; lane: number }[] = [];
  let clusterEnd = -Infinity;
  const flush = () => {
    const lanes = Math.max(1, ...cluster.map((c) => c.lane + 1));
    for (const c of cluster) out.set(c.item.id, { lane: c.lane, lanes });
    cluster = [];
  };
  for (const item of sorted) {
    if (item.start >= clusterEnd) {
      flush();
      clusterEnd = -Infinity;
    }
    const used = new Set(cluster.filter((c) => c.item.end > item.start).map((c) => c.lane));
    let lane = 0;
    while (used.has(lane)) lane++;
    cluster.push({ item, lane });
    clusterEnd = Math.max(clusterEnd, item.end);
  }
  flush();
  return out;
}
