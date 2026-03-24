export interface PaginationParams {
  page?: number;
  limit?: number;
}

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/**
 * Parse and normalize pagination parameters.
 * Ensures page >= 1, limit is capped at maxLimit.
 */
export function parsePagination(
  params: PaginationParams,
  defaultLimit = 50,
  maxLimit = 100,
): { skip: number; take: number; page: number; limit: number } {
  const page = Math.max(params.page || 1, 1);
  const limit = Math.min(Math.max(params.limit || defaultLimit, 1), maxLimit);
  const skip = (page - 1) * limit;
  return { skip, take: limit, page, limit };
}

/**
 * Build a paginated result object.
 */
export function paginatedResult<T>(
  data: T[],
  total: number,
  page: number,
  limit: number,
): PaginatedResult<T> {
  return {
    data,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
}
