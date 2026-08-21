// P5.1 React hooks 集合
import { useState, useEffect } from 'react';

/** 通用 debounce hook: input 改变后等 delay ms 才更新返回值 */
export function useDebounce<T>(value: T, delay = 250): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}
