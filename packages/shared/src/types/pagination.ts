export interface PaginatedResult<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export interface PaginationQuery {
  page?: number;
  pageSize?: number;
  sort?: string;
}
