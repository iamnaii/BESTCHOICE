/**
 * Standardized pagination response shape for all list endpoints.
 * Use `paginatedResponse()` to wrap paginated query results.
 */
export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/**
 * Create a standardized paginated response object.
 * @param data - Array of items for the current page
 * @param total - Total number of items matching the query
 * @param page - Current page number (1-based)
 * @param limit - Items per page
 */
export function paginatedResponse<T>(
  data: T[],
  total: number,
  page: number,
  limit: number,
): PaginatedResponse<T> {
  return {
    data,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
}
