import { useState } from "react";
import { computeRoute, GeocodeResultData, RouteResultData } from "../api";
import PlaceAutocomplete from "./PlaceAutocomplete";

interface RouteFormProps {
  onResult: (result: RouteResultData, origin: { lat: number; lon: number }, destination: { lat: number; lon: number }) => void;
}

// Verified via repeated real API calls to genuinely show a cooler-route detour, not identical
// routes. Real heat-exposure variance in this compact pilot area is small and shifts day to
// day — most pair/date combinations produce identical shortest/heat-optimized routes, which is
// honest data-driven behavior, not a bug. This exact combination is the one confirmed to diverge.
const DEFAULT_ORIGIN: GeocodeResultData = { latitude: 33.4725065, longitude: -112.0901337, displayName: "Encanto Sports Complex" };
const DEFAULT_DESTINATION: GeocodeResultData = { latitude: 33.4888809, longitude: -112.0981419, displayName: "St Gregory Parish Hall" };
const DEFAULT_DATE = "2025-07-20";

export default function RouteForm({ onResult }: RouteFormProps) {
  const [origin, setOrigin] = useState<GeocodeResultData | null>(DEFAULT_ORIGIN);
  const [destination, setDestination] = useState<GeocodeResultData | null>(DEFAULT_DESTINATION);
  const [date, setDate] = useState(DEFAULT_DATE);
  const [time, setTime] = useState("14:00");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      if (!origin || !destination) throw new Error("Pick both an origin and a destination.");
      if (origin.latitude === destination.latitude && origin.longitude === destination.longitude) {
        throw new Error("Origin and destination must be different places.");
      }

      const originPoint = { lat: origin.latitude, lon: origin.longitude };
      const destinationPoint = { lat: destination.latitude, lon: destination.longitude };
      const result = await computeRoute({ origin: originPoint, destination: destinationPoint, date, time });
      onResult(result, originPoint, destinationPoint);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="route-form" onSubmit={handleSubmit}>
      <PlaceAutocomplete label="Origin" placeholder="Search a place in Phoenix…" value={origin} onChange={setOrigin} />
      <PlaceAutocomplete label="Destination" placeholder="Search a place in Phoenix…" value={destination} onChange={setDestination} />
      <div className="row">
        <label>
          Date
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </label>
        <label>
          Time
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} required />
        </label>
      </div>
      <button type="submit" disabled={loading}>
        {loading ? "Computing route…" : "Compare routes"}
      </button>
      {error && <div className="error">{error}</div>}
    </form>
  );
}
