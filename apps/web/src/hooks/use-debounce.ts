import { useEffect, useState } from 'react';

/**
 * Custom hook to debounce any fast-changing value.
 *
 * @param value The value to debounce.
 * @param delayMs Debounce delay in milliseconds (default: 400ms).
 */
export function useDebounce<T>(value: T, delayMs: number = 400): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delayMs);

    return () => {
      clearTimeout(handler);
    };
  }, [value, delayMs]);

  return debouncedValue;
}
