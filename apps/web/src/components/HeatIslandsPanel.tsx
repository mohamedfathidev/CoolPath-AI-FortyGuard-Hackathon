import { useState } from "react";
import { fetchHeatIslands, HeatIslandsData } from "../api";

interface HeatIslandsPanelProps {
  onData: (data: HeatIslandsData | null) => void;
}

// Same demo date the routing feature uses — its exceedance data is already cached, so this loads fast.
const DEFAULT_DATE = "2025-07-20";

export default function HeatIslandsPanel({ onData }: HeatIslandsPanelProps) {
  const [date, setDate] = useState(DEFAULT_DATE);
  const [data, setData] = useState<HeatIslandsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchHeatIslands(date);
      setData(result);
      onData(result);
    } catch (err) {
      setError((err as Error).message);
      onData(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="heat-islands">
      <p className="hi-intro">
        See where extreme heat concentrates across the city — every block coloured by how many hours a day it
        spends above {data ? Math.round(data.thresholdF) : 95}°F, straight from FortyGuard's exceedance data.
      </p>
      <div className="row">
        <label>
          Date
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
      </div>
      <button type="button" className="hi-load" onClick={load} disabled={loading}>
        {loading ? "Mapping heat islands…" : "Map the heat islands"}
      </button>
      {error && <div className="error">{error}</div>}

      {data && (
        <>
          <div className="hi-stats">
            <div className="hi-stat cool">
              <span className="hi-val">{data.minHours.toFixed(1)}</span>
              <span className="hi-lbl">coolest (hrs/day)</span>
            </div>
            <div className="hi-stat gap">
              <span className="hi-val">+{data.spreadHours.toFixed(1)}</span>
              <span className="hi-lbl">heat-island gap</span>
            </div>
            <div className="hi-stat hot">
              <span className="hi-val">{data.maxHours.toFixed(1)}</span>
              <span className="hi-lbl">hottest (hrs/day)</span>
            </div>
          </div>

          <h4 className="hi-h">Hottest zones</h4>
          <ol className="hi-hotspots">
            {data.hotspots.map((h, i) => (
              <li key={i}>
                <span className="hi-rank">{i + 1}</span>
                <span className="hi-place">{h.label}</span>
                <span className="hi-hours">{h.exposureHours.toFixed(1)} hrs</span>
              </li>
            ))}
          </ol>

          <div className="hi-insight">
            <strong>🌍 Climate insight</strong>
            <p>{data.insight}</p>
          </div>
        </>
      )}
    </div>
  );
}
