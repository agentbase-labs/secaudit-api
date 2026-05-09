'use client';

import { useQuery } from '@tanstack/react-query';
import { meRequest } from '../auth';

export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: meRequest,
    retry: false,
  });
}
