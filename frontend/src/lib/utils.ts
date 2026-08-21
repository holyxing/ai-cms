import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** API 响应统一格式 */
export interface APIResponse<T = unknown> {
  code: number;
  message: string;
  data: T | null;
  errors?: unknown[];
}

/** 分页响应 */
export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
}
