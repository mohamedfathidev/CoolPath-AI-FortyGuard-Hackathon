import { useState } from "react";
import MapView from "./components/MapView";
import RouteForm from "./components/RouteForm";
import RouteSummary from "./components/RouteSummary";
import AgentChat from "./components/AgentChat";
import type { RouteResultData } from "./api";
import { CITY_NAME } from "./cityConfig";

type Tab = "map" | "agent";
export type RouteSelection = "both" | "shortest" | "heatOptimized";

export default function App() {
  const [tab, setTab] = useState<Tab>("agent");
  const [route, setRoute] = useState<RouteResultData | null>(null);
  const [origin, setOrigin] = useState<{ lat: number; lon: number } | null>(null);
  const [destination, setDestination] = useState<{ lat: number; lon: number } | null>(null);
  const [selection, setSelection] = useState<RouteSelection>("both");

  function handleRoute(result: RouteResultData, o?: { lat: number; lon: number }, d?: { lat: number; lon: number }) {
    setRoute(result);
    if (o) setOrigin(o);
    if (d) setDestination(d);
    setSelection("both");
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
            <button className={tab === "map" ? "active" : ""} onClick={() => setTab("map")}>
              Plan a route
            </button>
            <button className={tab === "agent" ? "active" : ""} onClick={() => setTab("agent")}>
              Ask the agent
            </button>
          </div>

          {tab === "map" ? (
            <RouteForm onResult={(result, o, d) => handleRoute(result, o, d)} />
          ) : (
            <AgentChat onRouteResult={(result) => handleRoute(result)} />
          )}

          {route && <RouteSummary route={route} selection={selection} onSelect={setSelection} />}
        </aside>
        <main className="map-container">
          <MapView route={route} origin={origin} destination={destination} selection={selection} />
        </main>
      </div>
    </div>
  );
}
