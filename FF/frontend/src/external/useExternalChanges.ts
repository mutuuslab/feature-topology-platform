import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { DEMO_EXTRAS } from '../auth-mode';
import { EXTERNAL_CHANGE_KEY } from './links';

const QUERIES = ['extSync', 'extInbox', 'extConflicts', 'extOutbox', 'extFeatureTrace', 'extFeatureEpics', 'extChangeRequests', 'featureDetail', 'listFeatures', 'mockExtItems'];

/** 별도 창에서 공유 서버를 바꾸면 열려 있는 플랫폼의 추적·수신함도 다시 읽는다. */
export function useExternalChanges() {
  const client = useQueryClient();
  useEffect(() => {
    if (!DEMO_EXTRAS) return;
    const changed = (event: StorageEvent) => {
      if (event.key === EXTERNAL_CHANGE_KEY) for (const name of QUERIES) void client.invalidateQueries({ queryKey: [name] });
    };
    window.addEventListener('storage', changed);
    return () => window.removeEventListener('storage', changed);
  }, [client]);
}
