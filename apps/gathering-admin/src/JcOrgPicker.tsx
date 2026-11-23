import { useEffect, useState } from 'react';
import { api } from './api';
import type { JcChoice, MemberItem } from './types';

export function JcOrgPicker({ member }: { member?: MemberItem['user'] }) {
  const [districtId, setDistrictId] = useState(
    member?.affiliationNeedsReselect ? '' : (member?.district?.id ?? ''),
  );
  const [localId, setLocalId] = useState(
    member?.affiliationNeedsReselect ? '' : (member?.localId ?? ''),
  );
  const districts = useJcChoices('/api/gathering/jc-orgs/districts');
  const locals = useJcChoices(
    districtId ? `/api/gathering/jc-orgs/districts/${districtId}/locals` : '',
  );

  return (
    <>
      {member?.affiliationNeedsReselect ? (
        <p className="hint">기존 소속 “{member.localJcName}”의 지구와 로컬을 다시 선택해 주세요.</p>
      ) : null}
      <label>
        소속 지구
        <select
          required
          value={districtId}
          onChange={(event) => {
            setDistrictId(event.target.value);
            setLocalId('');
          }}
        >
          <option value="">{districts.loading ? '지구 불러오는 중' : '지구 선택'}</option>
          {districts.items.map((org) => (
            <option key={org.id} value={org.id}>
              {org.displayName}
            </option>
          ))}
        </select>
      </label>
      <label>
        소속 로컬
        <select
          name="localId"
          required
          value={localId}
          disabled={!districtId}
          onChange={(event) => setLocalId(event.target.value)}
        >
          <option value="">
            {!districtId
              ? '지구를 먼저 선택하세요'
              : locals.loading
                ? '로컬 불러오는 중'
                : '로컬 선택'}
          </option>
          {locals.items.map((org) => (
            <option key={org.id} value={org.id}>
              {org.displayName}
            </option>
          ))}
        </select>
      </label>
      {districts.error || locals.error ? (
        <p className="error" role="alert">
          조직 목록을 불러오지 못했습니다.{' '}
          <button
            type="button"
            className="ghost"
            onClick={districts.error ? districts.retry : locals.retry}
          >
            다시 시도
          </button>
        </p>
      ) : null}
    </>
  );
}

function useJcChoices(path: string) {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{
    path: string;
    attempt: number;
    items: JcChoice[];
    error: boolean;
  } | null>(null);

  useEffect(() => {
    if (!path) return;
    const controller = new AbortController();
    api<{ items: JcChoice[] }>(path, { signal: controller.signal }).then(
      ({ items }) => setResult({ path, attempt, items, error: false }),
      () => {
        if (!controller.signal.aborted) setResult({ path, attempt, items: [], error: true });
      },
    );
    return () => controller.abort();
  }, [path, attempt]);

  const current = result?.path === path && result.attempt === attempt ? result : null;
  return {
    items: current?.items ?? [],
    loading: Boolean(path && !current),
    error: current?.error ?? false,
    retry: () => setAttempt((previous) => previous + 1),
  };
}
