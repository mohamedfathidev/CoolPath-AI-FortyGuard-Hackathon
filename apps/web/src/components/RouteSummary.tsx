import type { RouteResultData } from "../api";
import type { RouteSelection } from "../App";

function fmtMin(seconds: number): string {
  return `${Math.round(seconds / 60)} min`;
}

function fmtTemp(f: number): string {
  const c = ((f - 32) * 5) / 9;
  return `${f.toFixed(1)}°F (${c.toFixed(1)}°C)`;
}

// Build a Google Maps walking-directions URL that follows OUR computed path, by handing Google
// the origin, destination, and a handful of intermediate waypoints sampled along the route.
// (Consumer Google Maps allows only a limited number of waypoints, so we sample, not send all.)
function googleMapsUrl(coords: [number, number][]): string {
  if (coords.length < 2) return "https://www.google.com/maps";
  const origin = coords[0];
  const destination = coords[coords.length - 1];
  const interior = coords.slice(1, -1);

  const MAX_WAYPOINTS = 8;
  const waypoints: [number, number][] = [];
  if (interior.length > 0) {
    const step = Math.max(1, Math.floor(interior.length / MAX_WAYPOINTS));
    for (let i = 0; i < interior.length && waypoints.length < MAX_WAYPOINTS; i += step) {
      waypoints.push(interior[i]);
    }
  }

  const ll = ([lon, lat]: [number, number]) => `${lat},${lon}`;
  const params = new URLSearchParams({
    api: "1",
    origin: ll(origin),
    destination: ll(destination),
    travelmode: "walking",
  });
  if (waypoints.length) params.set("waypoints", waypoints.map(ll).join("|"));
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

interface RouteSummaryProps {
  route: RouteResultData;
  selection: RouteSelection;
  onSelect: (s: RouteSelection) => void;
}

export default function RouteSummary({ route, selection, onSelect }: RouteSummaryProps) {
  return (
    <div className="route-summary">
      <div className="legend">
        <span className="swatch shortest" /> Shortest route
        <span className="swatch heat" /> Heat-optimized route
      </div>

      <div className="route-select">
        <button
          type="button"
          className={`route-select-btn shortest ${selection === "shortest" ? "active" : ""}`}
          onClick={() => onSelect(selection === "shortest" ? "both" : "shortest")}
        >
          Shortest route
        </button>
        <button
          type="button"
          className={`route-select-btn heat ${selection === "heatOptimized" ? "active" : ""}`}
          onClick={() => onSelect(selection === "heatOptimized" ? "both" : "heatOptimized")}
        >
          Cooler route
        </button>
      </div>

      <div className="route-nav">
        <a
          className="route-nav-btn shortest"
          href={googleMapsUrl(route.shortest.coordinates)}
          target="_blank"
          rel="noopener noreferrer"
        >
          Navigate shortest in Google Maps ↗
        </a>
        <a
          className="route-nav-btn heat"
          href={googleMapsUrl(route.heatOptimized.coordinates)}
          target="_blank"
          rel="noopener noreferrer"
        >
          Navigate cooler in Google Maps ↗
        </a>
      </div>

      <table>
        <tbody>
          <tr>
            <td />
            <td>Shortest</td>
            <td>Heat-optimized</td>
          </tr>
          <tr>
            <td>Distance</td>
            <td>{Math.round(route.shortest.distance_m)} m</td>
            <td>{Math.round(route.heatOptimized.distance_m)} m</td>
          </tr>
          <tr>
            <td>Walk time</td>
            <td>{fmtMin(route.shortest.duration_s)}</td>
            <td>{fmtMin(route.heatOptimized.duration_s)}</td>
          </tr>
          <tr>
            <td>Temp now</td>
            <td>{fmtTemp(route.shortest.avgTemperatureF)}</td>
            <td>{fmtTemp(route.heatOptimized.avgTemperatureF)}</td>
          </tr>
          <tr>
            <td>Heat exposure/day</td>
            <td>{route.shortest.avgExposureHours.toFixed(1)} hrs</td>
            <td>{route.heatOptimized.avgExposureHours.toFixed(1)} hrs</td>
          </tr>
        </tbody>
      </table>
      <p className="delta">
        +{Math.round(route.extraDistance_m)} m / +{Math.round(route.extraDuration_s / 60)} min for{" "}
        {route.exposureReductionHours > 0
          ? `${route.exposureReductionHours.toFixed(2)} fewer hours/day of extreme-heat exposure`
          : "no additional heat-exposure benefit on this pair"}
        .
      </p>
    </div>
  );
}
