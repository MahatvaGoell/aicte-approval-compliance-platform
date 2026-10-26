import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from './api';

/** Runs a case command against the version the user is looking at. */
export function useCommand(view: any) {
  const qc = useQueryClient();
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState<string | null>(null);
  async function run(command: string, payload: Record<string, unknown> = {}) {
    setBusy(command);
    setError(null);
    try {
      await api.post(`/applications/${view.application.id}/commands`, { command, expectedVersion: view.application.rowVersion, ...payload });
      await qc.invalidateQueries({ queryKey: ['case', view.application.id] });
      await qc.invalidateQueries({ queryKey: ['timeline', view.application.id] });
      qc.invalidateQueries({ queryKey: ['applications'] });
      qc.invalidateQueries({ queryKey: ['evc'] });
      return true;
    } catch (e) {
      setError(e);
      // A 409 usually means someone else changed the case; reload so the next attempt uses fresh data.
      qc.invalidateQueries({ queryKey: ['case', view.application.id] });
      return false;
    } finally {
      setBusy(null);
    }
  }
  return { run, error, busy };
}

