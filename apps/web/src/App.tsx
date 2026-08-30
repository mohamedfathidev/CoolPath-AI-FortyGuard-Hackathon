import { useState } from "react";
import MapView from "./components/MapView";
import RouteForm from "./components/RouteForm";
import RouteSummary from "./components/RouteSummary";
import AgentChat from "./components/AgentChat";
import HeatIslandsPanel from "./components/HeatIslandsPanel";
import type { HeatIslandsData, RouteResultData } from "./api";
import { CITY_NAME } from "./cityConfig";

type Tab = "map" | "agent" | "islands";
export type RouteSelection = "both" | "shortest" | "heatOptimized";

export default function App() {
  const [tab, setTab] = useState<Tab>("agent");
  const [route, setRoute] = useState<RouteResultData | null>(null);
  const [origin, setOrigin] = useState<{ lat: number; lon: number } | null>(null);
  const [destination, setDestination] = useState<{ lat: number; lon: number } | null>(null);
  const [selection, setSelection] = useState<RouteSelection>("both");
  const [heatIslands, setHeatIslands] = useState<HeatIslandsData | null>(null);

  function handleRoute(result: RouteResultData, o?: { lat: number; lon: number }, d?: { lat: number; lon: number }) {
    setRoute(result);
    if (o) setOrigin(o);
    if (d) setDestination(d);
    setSelection("both");
  }

  function selectTab(next: Tab) {
    setTab(next);
    // The route lines and the heat-island overlay are separate visual modes — clear one when
    // switching to the other so the map isn't a confusing mix of both.
    if (next === "islands") {
      setRoute(null);
    } else {
      setHeatIslands(null);
    }
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>CoolPath Agent</h1>
        <span className="city-tag">{CITY_NAME}</span>
      </header>
      <div className="app-body">
        <aside className="sidebar">
          <div className="tabs">
            <button className={tab === "map" ? "active" : ""} onClick={() => selectTab("map")}>
              Plan a route
            </button>
            <button className={tab === "agent" ? "active" : ""} onClick={() => selectTab("agent")}>
              Ask the agent
            </button>
            <button className={tab === "islands" ? "active" : ""} onClick={() => selectTab("islands")}>
              Heat islands
            </button>
          </div>

          {tab === "map" && <RouteForm onResult={(result, o, d) => handleRoute(result, o, d)} />}
          {tab === "agent" && <AgentChat onRouteResult={(result) => handleRoute(result)} />}
          {tab === "islands" && <HeatIslandsPanel onData={setHeatIslands} />}

          {tab !== "islands" && route && (
            <RouteSummary route={route} selection={selection} onSelect={setSelection} />
          )}
        </aside>
        <main className="map-container">
          <MapView
            route={route}
            origin={origin}
            destination={destination}
            selection={selection}
            heatIslands={heatIslands}
          />
        </main>
      </div>
    </div>
  );
}
