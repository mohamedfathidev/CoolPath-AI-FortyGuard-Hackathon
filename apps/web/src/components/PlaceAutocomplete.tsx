import { useEffect, useRef, useState } from "react";
import { autocompleteQuery, GeocodeResultData } from "../api";

interface PlaceAutocompleteProps {
  label: string;
  placeholder?: string;
  value: GeocodeResultData | null;
  onChange: (value: GeocodeResultData | null) => void;
}

const DEBOUNCE_MS = 300;

export default function PlaceAutocomplete({ label, placeholder, value, onChange }: PlaceAutocompleteProps) {
  const [text, setText] = useState(value?.displayName ?? "");
  const [suggestions, setSuggestions] = useState<GeocodeResultData[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const requestIdRef = useRef(0);

  useEffect(() => {
    setText(value?.displayName ?? "");
  }, [value]);

  function handleInput(next: string) {
    setText(next);
    onChange(null);
    setOpen(true);

    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (next.trim().length < 2) {
      setSuggestions([]);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      const requestId = ++requestIdRef.current;
      setLoading(true);
      try {
        const results = await autocompleteQuery(next);
        if (requestId === requestIdRef.current) setSuggestions(results);
      } finally {
        if (requestId === requestIdRef.current) setLoading(false);
      }
    }, DEBOUNCE_MS);
  }

  function pick(result: GeocodeResultData) {
    onChange(result);
    setText(result.displayName);
    setSuggestions([]);
    setOpen(false);
  }

  return (
    <div className="place-autocomplete">
      <label>
        {label}
        <input
          value={text}
          placeholder={placeholder}
          onChange={(e) => handleInput(e.target.value)}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
        />
      </label>
      {open && (loading || suggestions.length > 0) && (
        <ul className="suggestions">
          {loading && <li className="hint">Searching…</li>}
          {!loading &&
            suggestions.map((s, i) => (
              <li key={i} onMouseDown={() => pick(s)}>
                {s.displayName}
              </li>
            ))}
        </ul>
      )}
      {open && !loading && text.trim().length >= 2 && suggestions.length === 0 && (
        <ul className="suggestions">
          <li className="hint">No matches within the pilot area.</li>
        </ul>
      )}
    </div>
  );
}
