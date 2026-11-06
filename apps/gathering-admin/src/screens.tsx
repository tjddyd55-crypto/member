import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError } from './api';
import type { AdminAccount, AuditItem, GroupItem, MemberItem } from './types';

function ErrorText({ error }: { error: string }) {
  return error ? <p className="error">{error}</p> : null;
}

function when(value: string | null) {
  if (!value) return '-';
  return new Date(value).toLocaleString('ko-KR');
}

function phoneLinks(phone: string | null) {
  if (!phone) return <span>연락처 권한 없음</span>;
  return (
    <span>
      {phone}{' '}
      <button type="button" className="ghost" onClick={() => void navigator.clipboard.writeText(phone)}>복사</button>{' '}
      <a href={`tel:${phone}`}>전화</a>{' '}
      <a href={`sms:${phone}`}>문자</a>
    </span>
  );
}

export function DashboardPage() {
  const [stats, setStats] = useState<Record<string, number | string> | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api<Record<string, number | string>>('/api/gathering-admin/dashboard')
      .then(setStats)
      .catch((cause) => setError(cause instanceof Error ? cause.message : '집계를 불러오지 못했습니다.'));
  }, []);
  const cards = [
    ['groupCount', '모임'],
    ['activeTrials', '체험 중'],
    ['activePaid', '정식'],
    ['expiredCount', '만료·취소'],
    ['suspendedCount', '정지'],
    ['memberCount', '활동 회원'],
    ['usedBytes', '사용 바이트'],
  ] as const;
  return (
    <section>
      <h1>대시보드</h1>
      <ErrorText error={error} />
      <div className="grid">
        {cards.map(([key, label]) => (
          <article key={key} className="card">
            <span>{label}</span>
            <b>{stats ? String(stats[key] ?? '-') : '…'}</b>
          </article>
        ))}
      </div>
    </section>
  );
}

export function GroupsPage() {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('all');
  const [sort, setSort] = useState('created');
  const [items, setItems] = useState<GroupItem[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    const params = new URLSearchParams({ status, sort });
    if (q.trim()) params.set('q', q.trim());
    api<{ items: GroupItem[] }>(`/api/gathering-admin/groups?${params.toString()}`)
      .then((row) => setItems(row.items))
      .catch((cause) => setError(cause instanceof Error ? cause.message : '모임을 불러오지 못했습니다.'));
  }, [q, status, sort]);
  return (
    <section>
      <h1>모임</h1>
      <div className="row">
        <label>검색<input value={q} onChange={(event) => setQ(event.target.value)} placeholder="이름 또는 ID" /></label>
        <label>상태<select value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="all">전체</option>
          <option value="trial">체험</option>
          <option value="paid">정식</option>
          <option value="complimentary">무상</option>
          <option value="expired">만료</option>
          <option value="suspended">정지</option>
        </select></label>
        <label>정렬<select value={sort} onChange={(event) => setSort(event.target.value)}>
          <option value="created">만든 날</option>
          <option value="expiry">만료</option>
          <option value="name">이름</option>
        </select></label>
      </div>
      <ErrorText error={error} />
      <table>
        <thead><tr><th>모임</th><th>생성자</th><th>현재 회장</th><th>이용</th><th>용량</th></tr></thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id}>
              <td><Link to={`/groups/${item.id}`}>{item.name}</Link><br />{item.id}</td>
              <td>{item.creator.name}<br />{phoneLinks(item.creator.phone)}</td>
              <td>{item.president?.name ?? '-'}<br />{phoneLinks(item.president?.phone ?? null)}</td>
              <td data-source={item.subscription.source ?? ''} data-expiry={item.subscription.expiresAt ?? ''}>{item.subscription.source ?? '-'} {item.subscription.status}{item.suspended ? ' · 정지' : ''}<br />{when(item.subscription.expiresAt)}</td>
              <td>{item.usedBytes} / {item.quotaBytes}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export function GroupPage({ role }: { role: 'SUPER_ADMIN' | 'ADMIN' }) {
  const { groupId = '' } = useParams();
  const [group, setGroup] = useState<GroupItem | null>(null);
  const [tab, setTab] = useState('기본');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [memberRefresh, setMemberRefresh] = useState(0);
  function reload() {
    api<GroupItem>(`/api/gathering-admin/groups/${groupId}`)
      .then(setGroup)
      .catch((cause) => setError(cause instanceof Error ? cause.message : '모임을 불러오지 못했습니다.'));
  }
  useEffect(reload, [groupId]);
  async function run(path: string, body: unknown) {
    setError('');
    setNotice('');
    try {
      await api(path, { method: 'POST', body: JSON.stringify(body) });
      setNotice('서버가 반영했습니다.');
      setMemberRefresh((value) => value + 1);
      reload();
      return true;
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : '저장하지 못했습니다.');
      return false;
    }
  }
  if (!group) return <ErrorText error={error || '불러오는 중'} />;
  const tabs = ['기본', '생성자/회장', '이용권', '입금', '용량', '회원', '감사'];
  return (
    <section>
      <h1>{group.name}</h1>
      <p data-quota={group.quotaBytes} data-suspended={group.suspended ? '1' : '0'} data-source={group.subscription.source ?? ''}>{group.subscription.status} {group.suspended ? '· 정지' : ''} · 만료 {when(group.subscription.expiresAt)} · {group.usedBytes}/{group.quotaBytes}</p>
      <ErrorText error={error} />
      {notice ? <p>{notice}</p> : null}
      <div className="tabs">
        {tabs.map((name) => <button key={name} className={tab === name ? 'on' : ''} onClick={() => setTab(name)}>{name}</button>)}
      </div>
      {tab === '기본' ? <p>만든 날 {when(group.createdAt)} · 회원 {group.memberCount} · 마지막 활동 {when(group.lastActivityAt)}</p> : null}
      {tab === '생성자/회장' ? (
        <div className="row">
          <article className="panel"><h2>최초 생성자</h2><p>{group.creator.name}</p><p>{group.creator.id}</p>{phoneLinks(group.creator.phone)}<p>{group.creator.localJcName} · {when(group.creator.since)}</p></article>
          <article className="panel"><h2>현재 회장</h2><p>{group.president?.name ?? '없음'}</p><p>{group.president?.id}</p>{phoneLinks(group.president?.phone ?? null)}<p>{group.president?.localJcName} · {when(group.president?.since ?? null)}</p></article>
        </div>
      ) : null}
      {tab === '이용권' ? <SubscriptionForm groupId={groupId} subscriptionId={group.subscription.id} onSubmit={run} /> : null}
      {tab === '입금' ? <DepositForm groupId={groupId} subscriptionId={group.subscription.id} role={role} onSubmit={run} /> : null}
      {tab === '용량' ? <QuotaForm groupId={groupId} onSubmit={run} /> : null}
      {tab === '회원' ? <GroupMembers groupId={groupId} refresh={memberRefresh} onSubmit={run} /> : null}
      {tab === '감사' ? <AuditsPage /> : null}
    </section>
  );
}

function operationKey(groupId: string, name: string) {
  return `${name}-${groupId}-${Math.random().toString(36).slice(2, 12)}`;
}

function SubscriptionForm({ groupId, subscriptionId, onSubmit }: { groupId: string; subscriptionId: string | null; onSubmit: (path: string, body: unknown) => Promise<boolean> }) {
  const [source, setSource] = useState<'PAID' | 'COMPLIMENTARY'>('PAID');
  const [startsAt, setStartsAt] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [reason, setReason] = useState('');
  const [approveKey, setApproveKey] = useState(() => operationKey(groupId, 'sub'));
  const [cancelKey, setCancelKey] = useState(() => operationKey(groupId, 'cancel'));
  const [stopKey, setStopKey] = useState(() => operationKey(groupId, 'stop'));
  const [resumeKey, setResumeKey] = useState(() => operationKey(groupId, 'resume'));
  useEffect(() => {
    setApproveKey(operationKey(groupId, 'sub'));
    setCancelKey(operationKey(groupId, 'cancel'));
    setStopKey(operationKey(groupId, 'stop'));
    setResumeKey(operationKey(groupId, 'resume'));
  }, [groupId]);
  return (
    <form className="panel row" onSubmit={(event) => {
      event.preventDefault();
      const body: Record<string, string> = { source, reason, idempotencyKey: approveKey };
      if (startsAt && expiresAt) {
        body.startsAt = new Date(startsAt).toISOString();
        body.expiresAt = new Date(expiresAt).toISOString();
      }
      void onSubmit(`/api/gathering-admin/groups/${groupId}/subscription`, body).then((saved) => {
        if (saved) setApproveKey(operationKey(groupId, 'sub'));
      });
    }}>
      <p>현재 이용권 {subscriptionId ?? '없음'}</p>
      <label>구분<select value={source} onChange={(event) => setSource(event.target.value as 'PAID' | 'COMPLIMENTARY')}><option value="PAID">정식</option><option value="COMPLIMENTARY">무상</option></select></label>
      <label>시작<input type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} /></label>
      <label>종료<input type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} /></label>
      <label>사유<input value={reason} onChange={(event) => setReason(event.target.value)} required /></label>
      <button type="submit">승인 또는 연장</button>
      <button type="button" className="ghost" onClick={() => void onSubmit(`/api/gathering-admin/groups/${groupId}/subscription/cancel`, { reason: reason || '취소', idempotencyKey: cancelKey }).then((saved) => { if (saved) setCancelKey(operationKey(groupId, 'cancel')); })}>취소</button>
      <button type="button" className="ghost" onClick={() => void onSubmit(`/api/gathering-admin/groups/${groupId}/suspension`, { suspended: true, reason: reason || '정지', idempotencyKey: stopKey }).then((saved) => { if (saved) setStopKey(operationKey(groupId, 'stop')); })}>모임 정지</button>
      <button type="button" className="ghost" onClick={() => void onSubmit(`/api/gathering-admin/groups/${groupId}/suspension`, { suspended: false, reason: reason || '해제', idempotencyKey: resumeKey }).then((saved) => { if (saved) setResumeKey(operationKey(groupId, 'resume')); })}>정지 해제</button>
    </form>
  );
}

function DepositForm({ groupId, subscriptionId: currentSubscriptionId, role, onSubmit }: { groupId: string; subscriptionId: string | null; role: 'SUPER_ADMIN' | 'ADMIN'; onSubmit: (path: string, body: unknown) => Promise<boolean> }) {
  const [payerName, setPayerName] = useState('');
  const [amountWon, setAmountWon] = useState('60000');
  const [paidOn, setPaidOn] = useState('');
  const [subscriptionId, setSubscriptionId] = useState(currentSubscriptionId ?? '');
  const [allowMismatch, setAllowMismatch] = useState(false);
  const [depositId, setDepositId] = useState('');
  const [recordKey, setRecordKey] = useState(() => operationKey(groupId, 'dep'));
  const [pending, setPending] = useState<Array<{ id: string; payerName: string; amountWon: number; status: string }>>([]);
  const [error, setError] = useState('');
  function loadPending() {
    api<{ items: Array<{ id: string; payerName: string; amountWon: number; status: string }> }>(`/api/gathering-admin/groups/${groupId}/deposits`)
      .then((row) => setPending(row.items.filter((item) => item.status === 'PENDING')))
      .catch(() => setPending([]));
  }
  useEffect(loadPending, [groupId]);
  return (
    <form className="panel row" onSubmit={(event) => {
      event.preventDefault();
      setError('');
      void api<{ id: string }>(`/api/gathering-admin/groups/${groupId}/deposits`, {
        method: 'POST',
        body: JSON.stringify({
          payerName,
          amountWon: Number(amountWon),
          paidOn: new Date(paidOn).toISOString(),
          idempotencyKey: recordKey,
        }),
      }).then((created) => {
        setDepositId(created.id);
        setRecordKey(operationKey(groupId, 'dep'));
        loadPending();
      }).catch((cause) => {
        setDepositId('');
        setError(cause instanceof ApiError ? cause.message : '입금을 기록하지 못했습니다.');
      });
    }}>
      <ErrorText error={error} />
      <label>입금자<input value={payerName} onChange={(event) => setPayerName(event.target.value)} required /></label>
      <label>금액<input value={amountWon} onChange={(event) => setAmountWon(event.target.value)} inputMode="numeric" /></label>
      <label>입금일<input type="datetime-local" value={paidOn} onChange={(event) => setPaidOn(event.target.value)} required /></label>
      <button type="submit">입금 기록</button>
      {pending.length > 0 ? (
        <div>
          <p>확인 전 입금</p>
          {pending.map((item) => (
            <button key={item.id} type="button" className={depositId === item.id ? '' : 'ghost'} onClick={() => setDepositId(item.id)}>
              {item.payerName} {item.amountWon}
            </button>
          ))}
        </div>
      ) : null}
      {depositId ? <p>기록 {depositId}. 확인 전에는 이용권에 연결되지 않습니다.</p> : null}
      <label>연결할 이용권 ID<input value={subscriptionId} onChange={(event) => setSubscriptionId(event.target.value)} /></label>
      {role === 'SUPER_ADMIN' ? <label><input type="checkbox" checked={allowMismatch} onChange={(event) => setAllowMismatch(event.target.checked)} /> 금액이 달라도 슈퍼관리자가 연결</label> : null}
      <button type="button" disabled={!depositId} onClick={() => void onSubmit(`/api/gathering-admin/deposits/${depositId}/confirm`, {
        reason: '은행 확인',
        idempotencyKey: `confirm-${depositId}`,
        subscriptionId: subscriptionId || undefined,
        allowMismatch,
      }).then((saved) => {
        if (!saved) return;
        setDepositId('');
        loadPending();
      })}>확인{subscriptionId ? ' 후 연결' : ''}</button>
    </form>
  );
}

function QuotaForm({ groupId, onSubmit }: { groupId: string; onSubmit: (path: string, body: unknown) => Promise<boolean> }) {
  const [quotaBytes, setQuotaBytes] = useState('50000000000');
  const [reason, setReason] = useState('');
  const [quotaKey, setQuotaKey] = useState(() => operationKey(groupId, 'quota'));
  useEffect(() => setQuotaKey(operationKey(groupId, 'quota')), [groupId]);
  return (
    <form className="panel row" onSubmit={(event: FormEvent) => {
      event.preventDefault();
      void onSubmit(`/api/gathering-admin/groups/${groupId}/quota`, {
        quotaBytes: Number(quotaBytes),
        reason,
        idempotencyKey: quotaKey,
      }).then((saved) => {
        if (saved) setQuotaKey(operationKey(groupId, 'quota'));
      });
    }}>
      <label>할당 바이트<input value={quotaBytes} onChange={(event) => setQuotaBytes(event.target.value)} /></label>
      <label>사유<input value={reason} onChange={(event) => setReason(event.target.value)} required /></label>
      <button type="submit">용량 변경</button>
      <p>용량을 줄여도 이미 올린 파일은 지우지 않습니다.</p>
    </form>
  );
}

function GroupMembers({ groupId, refresh, onSubmit }: { groupId: string; refresh: number; onSubmit: (path: string, body: unknown) => Promise<boolean> }) {
  const [items, setItems] = useState<MemberItem[]>([]);
  useEffect(() => {
    api<{ items: MemberItem[] }>(`/api/gathering-admin/members?groupId=${encodeURIComponent(groupId)}`)
      .then((row) => setItems(row.items))
      .catch(() => setItems([]));
  }, [groupId, refresh]);
  return (
    <table>
      <tbody>
        {items.map((item) => (
          <tr key={item.membershipId}>
            <td>{item.user.name}<br />{phoneLinks(item.user.phone)}<br />{item.status}</td>
            <td>
              <button type="button" onClick={() => void onSubmit(`/api/gathering-admin/groups/${groupId}/members/${item.membershipId}/restriction`, { suspended: item.status !== 'SUSPENDED', reason: '운영 제한', idempotencyKey: `mem-${item.membershipId}-${Date.now()}` })}>
                {item.status === 'SUSPENDED' ? '제한 해제' : '제한'}
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function MembersPage() {
  const [q, setQ] = useState('');
  const [items, setItems] = useState<MemberItem[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    api<{ items: MemberItem[] }>(`/api/gathering-admin/members${q ? `?q=${encodeURIComponent(q)}` : ''}`)
      .then((row) => setItems(row.items))
      .catch((cause) => setError(cause instanceof Error ? cause.message : '회원을 불러오지 못했습니다.'));
  }, [q]);
  return (
    <section>
      <h1>회원</h1>
      <label>검색<input value={q} onChange={(event) => setQ(event.target.value)} /></label>
      <ErrorText error={error} />
      <table>
        <tbody>
          {items.map((item) => (
            <tr key={item.membershipId}><td>{item.user.name}</td><td>{item.group.name}</td><td>{item.status}</td><td>{phoneLinks(item.user.phone)}</td></tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export function AuditsPage() {
  const [items, setItems] = useState<AuditItem[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    api<{ items: AuditItem[] }>('/api/gathering-admin/audits')
      .then((row) => setItems(row.items))
      .catch((cause) => setError(cause instanceof Error ? cause.message : '이력을 불러오지 못했습니다.'));
  }, []);
  return (
    <section>
      <h1>운영이력</h1>
      <ErrorText error={error} />
      <table>
        <tbody>
          {items.map((item) => (
            <tr key={item.id}><td>{when(item.createdAt)}</td><td>{item.action}</td><td>{item.actor?.loginId ?? '-'}</td><td>{item.reason ?? ''}</td></tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export function SettingsPage({ role }: { role: 'SUPER_ADMIN' | 'ADMIN' }) {
  const [bankName, setBankName] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [holder, setHolder] = useState('');
  const [memo, setMemo] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => {
    if (role !== 'SUPER_ADMIN') return;
    api<{ setting: { bankName: string; accountNumber: string; holder: string; memo: string | null } | null }>('/api/gathering-admin/settings/bank')
      .then((row) => {
        if (!row.setting) return;
        setBankName(row.setting.bankName);
        setAccountNumber(row.setting.accountNumber);
        setHolder(row.setting.holder);
        setMemo(row.setting.memo ?? '');
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : '설정을 불러오지 못했습니다.'));
  }, [role]);
  if (role !== 'SUPER_ADMIN') return <p>계좌 설정은 슈퍼관리자만 봅니다.</p>;
  return (
    <form className="panel row" onSubmit={(event) => {
      event.preventDefault();
      setNotice('');
      api('/api/gathering-admin/settings/bank', {
        method: 'PUT',
        body: JSON.stringify({ bankName, accountNumber, holder, memo, reason: '설정 저장' }),
      }).then(() => setNotice('저장했습니다.')).catch((cause) => setError(cause instanceof Error ? cause.message : '저장하지 못했습니다.'));
    }}>
      <h1>시스템설정</h1>
      <ErrorText error={error} />
      {notice ? <p>{notice}</p> : null}
      <label>은행<input value={bankName} onChange={(event) => setBankName(event.target.value)} required /></label>
      <label>계좌<input value={accountNumber} onChange={(event) => setAccountNumber(event.target.value)} required /></label>
      <label>예금주<input value={holder} onChange={(event) => setHolder(event.target.value)} required /></label>
      <label>메모<textarea value={memo} onChange={(event) => setMemo(event.target.value)} /></label>
      <button type="submit">저장</button>
      <p>이 계좌는 회원 앱에 내려가지 않습니다.</p>
    </form>
  );
}

const ADMIN_CAPABILITY_OPTIONS = [
  ['GROUP_READ', '모임 조회'],
  ['MEMBER_READ', '회원 조회'],
  ['CONTACT_READ', '연락처'],
  ['AUDIT_READ', '운영이력'],
  ['SUBSCRIPTION_WRITE', '이용권'],
  ['PAYMENT_WRITE', '입금'],
  ['QUOTA_WRITE', '용량'],
  ['MEMBER_RESTRICT', '회원 제한'],
  ['SETTINGS', '설정'],
] as const;

export function AdminsPage({ role, adminId }: { role: 'SUPER_ADMIN' | 'ADMIN'; adminId: string }) {
  const [items, setItems] = useState<AdminAccount[]>([]);
  const [error, setError] = useState('');
  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [groupId, setGroupId] = useState('');
  const [capabilities, setCapabilities] = useState<string[]>(['GROUP_READ', 'MEMBER_READ']);
  function load() {
    api<{ items: AdminAccount[] }>('/api/gathering-admin/admins').then((row) => setItems(row.items)).catch((cause) => setError(cause instanceof Error ? cause.message : '계정을 불러오지 못했습니다.'));
  }
  useEffect(load, []);
  if (role !== 'SUPER_ADMIN') return <p>관리자 계정은 슈퍼관리자만 봅니다.</p>;
  return (
    <section>
      <h1>관리자</h1>
      <ErrorText error={error} />
      <form className="row" onSubmit={(event) => {
        event.preventDefault();
        api('/api/gathering-admin/admins', {
          method: 'POST',
          body: JSON.stringify({
            loginId,
            password,
            role: 'ADMIN',
            reason: '담당 지정',
            scopes: groupId ? capabilities.map((capability) => ({ groupId, capability })) : [],
          }),
        }).then(load).catch((cause) => setError(cause instanceof Error ? cause.message : '만들지 못했습니다.'));
      }}>
        <label>아이디<input value={loginId} onChange={(event) => setLoginId(event.target.value)} /></label>
        <label>임시 비밀번호<input type="password" minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} /></label>
        <label>모임 ID<input value={groupId} onChange={(event) => setGroupId(event.target.value)} /></label>
        <fieldset>
          <legend>이 모임의 권한</legend>
          {ADMIN_CAPABILITY_OPTIONS.map(([capability, label]) => (
            <label key={capability}>
              <input
                type="checkbox"
                checked={capabilities.includes(capability)}
                onChange={(event) => {
                  setCapabilities((current) => event.target.checked ? [...current, capability] : current.filter((item) => item !== capability));
                }}
              /> {label}
            </label>
          ))}
        </fieldset>
        <button type="submit">담당 관리자 추가</button>
      </form>
      <table>
        <tbody>
          {items.map((item) => (
            <tr key={item.id}>
              <td>{item.loginId}<br />{item.role} {item.disabledAt ? '비활성' : ''} {item.totpReady ? '2FA' : '2FA 전'}</td>
              <td>{item.scopes.map((scope) => `${scope.capability}:${scope.groupId}`).join(', ')}</td>
              <td>{item.id !== adminId && !item.disabledAt ? <button type="button" onClick={() => api(`/api/gathering-admin/admins/${item.id}/disable`, { method: 'POST', body: JSON.stringify({ reason: '운영 종료' }) }).then(load).catch((cause) => setError(cause instanceof Error ? cause.message : '끄지 못했습니다.'))}>비활성</button> : null}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export function AccountPage({ onLogout }: { onLogout: () => void }) {
  const navigate = useNavigate();
  const [currentPassword, setCurrentPassword] = useState('');
  const [nextPassword, setNextPassword] = useState('');
  const [error, setError] = useState('');
  return (
    <form className="panel row" onSubmit={(event) => {
      event.preventDefault();
      api('/api/gathering-admin/auth/password', { method: 'POST', body: JSON.stringify({ currentPassword, nextPassword }) })
        .then(() => {
          onLogout();
          navigate('/login');
        })
        .catch((cause) => setError(cause instanceof Error ? cause.message : '바꾸지 못했습니다.'));
    }}>
      <h1>비밀번호</h1>
      <ErrorText error={error} />
      <label>현재<input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /></label>
      <label>새 비밀번호<input type="password" minLength={8} value={nextPassword} onChange={(event) => setNextPassword(event.target.value)} /></label>
      <button type="submit">변경 후 다시 로그인</button>
    </form>
  );
}
