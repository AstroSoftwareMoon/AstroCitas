import { createContext, useContext, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AppointmentQuery, Business, DataAdapter } from '@astrocitas/core';

export interface StorageInfo {
  /** 'opfs' | 'tauri' | 'memory' | 'remote' */
  kind: string;
  persistent: boolean;
}

interface DataCtx {
  db: DataAdapter;
  storage: StorageInfo;
}

const Ctx = createContext<DataCtx | null>(null);

export const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: false } },
});

export function DataProvider({ db, storage, children }: DataCtx & { children: ReactNode }) {
  return (
    <Ctx.Provider value={{ db, storage }}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </Ctx.Provider>
  );
}

export function useDb(): DataAdapter {
  const v = useContext(Ctx);
  if (!v) throw new Error('useDb fuera de DataProvider');
  return v.db;
}

export function useStorageInfo(): StorageInfo {
  return useContext(Ctx)!.storage;
}

export const useBusiness = () => {
  const db = useDb();
  return useQuery({ queryKey: ['business'], queryFn: () => db.getBusiness() });
};

/** Negocio garantizado (solo dentro de pantallas posteriores al onboarding). */
export function useBiz(): Business {
  const { data } = useBusiness();
  if (!data) throw new Error('Negocio no creado');
  return data;
}

export const useStaff = (includeInactive = false) => {
  const db = useDb();
  return useQuery({ queryKey: ['staff', includeInactive], queryFn: () => db.listStaff({ includeInactive }) });
};

export const useServices = (includeInactive = false) => {
  const db = useDb();
  return useQuery({ queryKey: ['services', includeInactive], queryFn: () => db.listServices({ includeInactive }) });
};

export const useClients = (search = '') => {
  const db = useDb();
  return useQuery({ queryKey: ['clients', search], queryFn: () => db.listClients({ search }) });
};

export const useClient = (id: string | null | undefined) => {
  const db = useDb();
  return useQuery({ queryKey: ['client', id], queryFn: () => (id ? db.getClient(id) : null), enabled: !!id });
};

export const useAppointments = (q: AppointmentQuery) => {
  const db = useDb();
  return useQuery({
    queryKey: ['appointments', q.from, q.to, q.staffId ?? null, q.clientId ?? null, !!q.includeCancelled],
    queryFn: () => db.listAppointments(q),
    placeholderData: (prev) => prev,
  });
};

export const useTimeOff = (from: number, to: number) => {
  const db = useDb();
  return useQuery({ queryKey: ['timeOff', from, to], queryFn: () => db.listTimeOff({ from, to }), placeholderData: (p) => p });
};

/** Mutación genérica que refresca todas las consultas al terminar (datos locales = barato). */
export function useAction<A extends unknown[], R>(fn: (db: DataAdapter, ...args: A) => Promise<R>) {
  const db = useDb();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: A) => fn(db, ...args),
    onSettled: () => qc.invalidateQueries(),
  });
}

export function useInvalidate() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries();
}
