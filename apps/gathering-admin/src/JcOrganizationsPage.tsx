import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { api, ApiError } from './api';
import type { JcDistrict, JcLocal, JcOrg, JcOrgHistory, JcReview } from './types';

const base = '/api/gathering-admin/jc-orgs';
type OrgType = 'districts' | 'locals';
type Dialog =
  | { mode: 'edit'; type: OrgType; org?: JcDistrict | JcLocal }
  | { mode: 'parent'; org: JcLocal }
  | { mode: 'service'; org: JcLocal }
  | { mode: 'status' | 'history'; type: OrgType; org: JcOrg };

function errorMessage(error: unknown) {
  return error instanceof ApiError ? error.message : '요청을 완료하지 못했습니다.';
}

function useOrgList<T>(path: string, revision = 0, delay = 0) {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{
    path: string;
    revision: number;
    attempt: number;
    items: T[];
    error: string;
  } | null>(null);

  useEffect(() => {
    if (!path) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      api<{ items: T[] }>(path, { signal: controller.signal }).then(
        ({ items }) => setResult({ path, revision, attempt, items, error: '' }),
        (error) => {
          if (!controller.signal.aborted)
            setResult({ path, revision, attempt, items: [], error: errorMessage(error) });
        },
      );
    }, delay);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [path, revision, attempt, delay]);

  const current = result?.path === path ? result : null;
  return {
    items: current?.items ?? [],
    error: current?.error ?? '',
    loading: Boolean(
      path && (!current || current.revision !== revision || current.attempt !== attempt),
    ),
    retry: () => setAttempt((count) => count + 1),
  };
}

function ListFeedback({
  error,
  loading,
  empty,
  retry,
}: {
  error: string;
  loading: boolean;
  empty: boolean;
  retry: () => void;
}) {
  if (loading) return <p role="status">불러오는 중</p>;
  if (error)
    return (
      <p className="error" role="alert">
        {error}{' '}
        <button type="button" className="ghost" onClick={retry}>
          다시 시도
        </button>
      </p>
    );
  return empty ? <p>검색 결과가 없습니다.</p> : null;
}

export function JcOrganizationsPage() {
  const [tab, setTab] = useState<'directory' | 'review'>('directory');
  const [districtQuery, setDistrictQuery] = useState('');
  const [localQuery, setLocalQuery] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [mobileLocals, setMobileLocals] = useState(false);
  const [revision, setRevision] = useState(0);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [error, setError] = useState('');
  const [verifying, setVerifying] = useState<string | null>(null);
  const districts = useOrgList<JcDistrict>(`${base}/districts`, revision);
  const district = districts.items.find((item) => item.id === selectedId) ?? districts.items[0];
  const locals = useOrgList<JcLocal>(
    district && tab === 'directory'
      ? `${base}/locals?${new URLSearchParams({ districtId: district.id, q: localQuery })}`
      : '',
    revision,
    localQuery ? 200 : 0,
  );
  const review = useOrgList<JcReview>(tab === 'review' ? `${base}/review` : '', revision);
  const filteredDistricts = districts.items.filter((item) =>
    [item.name, item.displayName].some((value) =>
      value.normalize('NFC').includes(districtQuery.trim().normalize('NFC')),
    ),
  );
  const reload = () => setRevision((count) => count + 1);

  async function verify(org: JcReview) {
    setError('');
    setVerifying(org.id);
    const type = org.orgType === 'LOCAL' ? 'locals' : 'districts';
    try {
      await api(`${base}/${type}/${org.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ verificationState: 'CONFIRMED' }),
      });
      reload();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setVerifying(null);
    }
  }

  return (
    <section>
      <h1>JC 조직 관리</h1>
      <div className="tabs" aria-label="JC 조직 목록">
        <button
          type="button"
          className={tab === 'directory' ? 'on' : ''}
          aria-pressed={tab === 'directory'}
          onClick={() => setTab('directory')}
        >
          지구 · 로컬
        </button>
        <button
          type="button"
          className={tab === 'review' ? 'on' : ''}
          aria-pressed={tab === 'review'}
          onClick={() => setTab('review')}
        >
          검토 필요
        </button>
      </div>
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
      {tab === 'review' ? (
        <div className="org-stack">
          <ListFeedback {...review} empty={!review.items.length} />
          {review.items.map((org) => (
            <article className="panel org-entry" key={org.id}>
              <div>
                <strong>{org.displayName}</strong>
                <span className="hint">
                  {' '}
                  ·{' '}
                  {org.orgType === 'DISTRICT'
                    ? '지구'
                    : (districts.items.find((item) => item.id === org.districtId)?.displayName ??
                      '로컬')}
                </span>
                <OrgBadges org={org} />
                <p>{org.reviewReason ?? '검토 사유가 등록되지 않았습니다.'}</p>
                {org.sourceUrl ? (
                  <a href={org.sourceUrl} target="_blank" rel="noreferrer">
                    출처 보기
                  </a>
                ) : null}
              </div>
              <button
                type="button"
                disabled={verifying !== null || review.loading}
                onClick={() => void verify(org)}
              >
                확인 완료
              </button>
            </article>
          ))}
        </div>
      ) : (
        <div className={`org-columns${mobileLocals ? ' show-locals' : ''}`}>
          <section className="panel org-districts org-stack" aria-label="지구 목록">
            <div className="org-heading">
              <h2>지구</h2>
              <button type="button" onClick={() => setDialog({ mode: 'edit', type: 'districts' })}>
                지구 추가
              </button>
            </div>
            <label>
              지구 검색
              <input
                type="search"
                value={districtQuery}
                onChange={(event) => setDistrictQuery(event.target.value)}
              />
            </label>
            <ListFeedback {...districts} empty={!filteredDistricts.length} />
            <ul className="org-list">
              {filteredDistricts.map((org) => (
                <li key={org.id}>
                  <button
                    type="button"
                    className="ghost org-district"
                    aria-pressed={district?.id === org.id}
                    onClick={() => {
                      setSelectedId(org.id);
                      setLocalQuery('');
                      setMobileLocals(true);
                    }}
                  >
                    <strong>{org.displayName}</strong>
                    <span className="hint">
                      활성 로컬 {org.activeLocalCount} / 전체 {org.totalLocalCount}
                    </span>
                    <span className="org-badges">
                      <OrgBadges org={org} />
                      {org.needsReviewCount > 0 ? (
                        <span className="org-badge review">로컬 검토 {org.needsReviewCount}</span>
                      ) : null}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
          <section className="panel org-locals org-stack" aria-label="로컬 목록">
            <button type="button" className="ghost org-back" onClick={() => setMobileLocals(false)}>
              ‹ 지구 목록
            </button>
            {district ? (
              <>
                <div className="org-heading">
                  <h2>{district.displayName}</h2>
                  <button type="button" onClick={() => setDialog({ mode: 'edit', type: 'locals' })}>
                    로컬 추가
                  </button>
                </div>
                <OrgActions type="districts" org={district} onOpen={setDialog} />
                <label>
                  로컬 검색
                  <input
                    type="search"
                    maxLength={120}
                    placeholder="이름 또는 승인 번호"
                    value={localQuery}
                    onChange={(event) => setLocalQuery(event.target.value)}
                  />
                </label>
                <ListFeedback {...locals} empty={!locals.items.length} />
                <ul className="org-list">
                  {locals.items.map((org) => (
                    <li className="org-entry" key={org.id}>
                      <div>
                        <strong>{org.displayName}</strong>
                        <p className="hint">{org.name}</p>
                        <p className="hint">승인 번호 {org.approvalNumber ?? '—'}</p>
                        <OrgBadges org={org} showActive />
                        <span className={org.serviceEnabled ? 'org-badge active' : 'org-badge'}>
                          서비스 {org.serviceEnabled ? '활성' : '비활성'}
                        </span>
                      </div>
                      <OrgActions type="locals" org={org} onOpen={setDialog} />
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p>지구를 선택해 주세요.</p>
            )}
          </section>
        </div>
      )}
      {dialog ? (
        <OrgDialog
          dialog={dialog}
          districts={districts.items}
          districtId={district?.id}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null);
            reload();
          }}
        />
      ) : null}
    </section>
  );
}

function OrgBadges({ org, showActive = false }: { org: JcOrg; showActive?: boolean }) {
  return (
    <>
      {org.verificationState === 'NEEDS_REVIEW' ? (
        <span className="org-badge review">검토 필요</span>
      ) : null}
      {!org.isActive ? (
        <span className="org-badge">비활성</span>
      ) : showActive ? (
        <span className="org-badge active">활성</span>
      ) : null}
    </>
  );
}

function OrgActions({
  org,
  type,
  onOpen,
}: {
  org: JcDistrict | JcLocal;
  type: OrgType;
  onOpen: (dialog: Dialog) => void;
}) {
  return (
    <div className="org-actions">
      <button type="button" className="ghost" onClick={() => onOpen({ mode: 'edit', type, org })}>
        수정
      </button>
      {'districtId' in org ? (
        <>
          <button type="button" className="ghost" onClick={() => onOpen({ mode: 'parent', org })}>
            소속 지구 변경
          </button>
          <button
            type="button"
            className="ghost"
            disabled={!org.isActive && !org.serviceEnabled}
            onClick={() => onOpen({ mode: 'service', org })}
          >
            서비스 {org.serviceEnabled ? '끄기' : '켜기'}
          </button>
        </>
      ) : null}
      <button type="button" className="ghost" onClick={() => onOpen({ mode: 'status', type, org })}>
        {org.isActive ? '비활성화' : '활성화'}
      </button>
      <button
        type="button"
        className="ghost"
        onClick={() => onOpen({ mode: 'history', type, org })}
      >
        이력
      </button>
    </div>
  );
}

function OrgDialog({
  dialog,
  districts,
  districtId,
  onClose,
  onSaved,
}: {
  dialog: Dialog;
  districts: JcDistrict[];
  districtId?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    ref.current?.showModal();
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (dialog.mode === 'history' || busy) return;
    const fields = new FormData(event.currentTarget);
    const read = (name: string) => String(fields.get(name) ?? '').trim();
    const { org } = dialog;
    setBusy(true);
    setError('');
    try {
      if (dialog.mode === 'parent') {
        await api(`${base}/locals/${dialog.org.id}/parent`, {
          method: 'POST',
          body: JSON.stringify({ districtId: read('districtId'), note: read('note') }),
        });
      } else if (dialog.mode === 'service') {
        await api(`${base}/locals/${dialog.org.id}/service`, {
          method: 'PATCH',
          body: JSON.stringify({
            enabled: !dialog.org.serviceEnabled,
            note: read('note') || undefined,
          }),
        });
      } else if (dialog.mode === 'status') {
        await api(`${base}/${dialog.type}/${dialog.org.id}/status`, {
          method: 'POST',
          body: JSON.stringify({ active: !dialog.org.isActive, note: read('note') }),
        });
      } else if (dialog.mode === 'edit') {
        await api(`${base}/${dialog.type}${org ? `/${org.id}` : ''}`, {
          method: org ? 'PATCH' : 'POST',
          body: JSON.stringify({
            name: read('name'),
            displayName: read('displayName') || null,
            sourceUrl: read('sourceUrl') || null,
            lastVerifiedAt: read('lastVerifiedAt') || null,
            adminNote: read('adminNote') || null,
            verificationState: read('verificationState'),
            reviewReason: read('reviewReason') || null,
            ...(dialog.type === 'locals'
              ? {
                  districtId: read('districtId'),
                  approvalNumber: read('approvalNumber') || null,
                }
              : {}),
          }),
        });
      }
      onSaved();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  const serviceAction =
    dialog.mode === 'service' ? `서비스 ${dialog.org.serviceEnabled ? '끄기' : '켜기'}` : '';
  const title =
    dialog.mode === 'service'
      ? serviceAction
      : dialog.mode === 'parent'
        ? '소속 지구 변경'
        : dialog.mode === 'history'
          ? '조직 변경 이력'
          : dialog.mode === 'status'
            ? dialog.org.isActive
              ? '조직 비활성화'
              : '조직 활성화'
            : `${dialog.type === 'locals' ? '로컬' : '지구'} ${dialog.org ? '수정' : '추가'}`;
  let content: ReactNode;
  if (dialog.mode === 'edit') {
    const org = dialog.org;
    const local = org && 'districtId' in org ? org : undefined;
    content = (
      <>
        <label>
          공식 이름
          <input name="name" required maxLength={120} defaultValue={org?.name} />
        </label>
        <label>
          표시 이름
          <input name="displayName" maxLength={120} defaultValue={org?.displayName} />
        </label>
        {dialog.type === 'locals' ? (
          <>
            <DistrictSelect districts={districts} id={local?.districtId ?? districtId} />
            <label>
              승인 번호
              <input
                name="approvalNumber"
                maxLength={60}
                defaultValue={local?.approvalNumber ?? ''}
              />
            </label>
          </>
        ) : null}
        <label>
          출처 URL
          <input name="sourceUrl" type="url" maxLength={2048} defaultValue={org?.sourceUrl ?? ''} />
        </label>
        <label>
          최종 확인일
          <input
            name="lastVerifiedAt"
            type="date"
            defaultValue={org?.lastVerifiedAt?.slice(0, 10)}
          />
        </label>
        <label>
          관리자 메모
          <textarea name="adminNote" maxLength={500} defaultValue={org?.adminNote ?? ''} />
        </label>
        <label>
          검토 상태
          <select name="verificationState" defaultValue={org?.verificationState ?? 'NEEDS_REVIEW'}>
            <option value="NEEDS_REVIEW">검토 필요</option>
            <option value="CONFIRMED">확인 완료</option>
          </select>
        </label>
        <label>
          검토 사유
          <textarea name="reviewReason" maxLength={500} defaultValue={org?.reviewReason ?? ''} />
        </label>
      </>
    );
  } else if (dialog.mode === 'parent') {
    content = (
      <>
        <p>{dialog.org.displayName}</p>
        <DistrictSelect districts={districts} id={dialog.org.districtId} />
        <ChangeNote />
      </>
    );
  } else if (dialog.mode === 'status' || dialog.mode === 'service') {
    content = (
      <>
        <p>{dialog.org.displayName}</p>
        <ChangeNote />
      </>
    );
  }
  return (
    <dialog
      className="panel org-dialog"
      ref={ref}
      aria-labelledby="org-dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <h2 id="org-dialog-title">{title}</h2>
      {dialog.mode === 'history' ? (
        <>
          <p>{dialog.org.displayName}</p>
          <HistoryList type={dialog.type} id={dialog.org.id} />
          <button type="button" className="ghost" onClick={onClose}>
            닫기
          </button>
        </>
      ) : (
        <form className="org-stack" onSubmit={(event) => void submit(event)}>
          {content}
          {error ? (
            <p className="error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="org-actions">
            <button type="submit" disabled={busy}>
              {serviceAction ||
                (dialog.mode === 'status' ? (dialog.org.isActive ? '비활성화' : '활성화') : '저장')}
            </button>
            <button type="button" className="ghost" disabled={busy} onClick={onClose}>
              취소
            </button>
          </div>
        </form>
      )}
    </dialog>
  );
}

function ChangeNote() {
  return (
    <label>
      변경 메모
      <textarea name="note" maxLength={500} />
    </label>
  );
}

function DistrictSelect({ districts, id }: { districts: JcDistrict[]; id?: string }) {
  return (
    <label>
      소속 지구
      <select name="districtId" required defaultValue={id ?? ''}>
        <option value="">지구 선택</option>
        {districts.map((org) => (
          <option key={org.id} value={org.id}>
            {org.displayName}
          </option>
        ))}
      </select>
    </label>
  );
}

const actions: Record<string, string> = {
  CREATE: '등록',
  RENAME: '이름 변경',
  UPDATE: '정보 수정',
  STATUS: '활성 상태 변경',
  SERVICE: '서비스 상태 변경',
  PARENT_CHANGE: '소속 지구 변경',
  VERIFY: '검토 상태 변경',
  SEED_CREATE: '공식 자료 등록',
  SEED_UPDATE: '공식 자료 갱신',
};

function HistoryList({ type, id }: { type: OrgType; id: string }) {
  const history = useOrgList<JcOrgHistory>(`${base}/${type}/${id}/history`);
  return (
    <>
      <ListFeedback {...history} empty={!history.items.length} />
      <ul className="org-list">
        {history.items.map((item) => (
          <li key={item.id} className="org-history">
            <strong>{actions[item.action] ?? item.action}</strong>
            <p className="hint">
              {new Date(item.createdAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })} KST ·{' '}
              {item.actorAdmin?.loginId ?? item.actorLabel ?? '—'}
            </p>
            {item.note ? <p>{item.note}</p> : null}
            <details>
              <summary>변경 전 → 변경 후</summary>
              <div className="org-history-columns">
                <div>
                  <b>변경 전</b>
                  <pre>{item.before ? JSON.stringify(item.before, null, 2) : '—'}</pre>
                </div>
                <div>
                  <b>변경 후</b>
                  <pre>{item.after ? JSON.stringify(item.after, null, 2) : '—'}</pre>
                </div>
              </div>
            </details>
          </li>
        ))}
      </ul>
    </>
  );
}
