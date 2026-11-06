import { useEffect, useState, type FormEvent } from 'react';
import { NavLink, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { api, ApiError, rememberCsrf } from './api';
import { AccountPage, AdminsPage, AuditsPage, DashboardPage, GroupPage, GroupsPage, MembersPage, SettingsPage } from './screens';
import type { Admin } from './types';

const LINKS = [
  ['/', '대시보드'],
  ['/groups', '모임'],
  ['/members', '회원'],
  ['/audits', '운영이력'],
  ['/settings', '시스템설정'],
  ['/admins', '관리자'],
  ['/account', '내 계정'],
] as const;

export function App() {
  const [admin, setAdmin] = useState<Admin | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    api<{ admin: Admin; csrfToken: string }>('/api/gathering-admin/me')
      .then((row) => {
        rememberCsrf(row.csrfToken);
        setAdmin(row.admin);
      })
      .catch(() => setAdmin(null))
      .finally(() => setReady(true));
  }, []);
  if (!ready) return <p>불러오는 중</p>;
  return (
    <Routes>
      <Route path="/login" element={<Login onDone={setAdmin} />} />
      <Route path="/enroll" element={admin ? <Navigate to="/" replace /> : <Login onDone={setAdmin} />} />
      <Route path="*" element={admin ? <Shell admin={admin} onLogout={() => setAdmin(null)} /> : <Navigate to="/login" replace />} />
    </Routes>
  );
}

function Shell({ admin, onLogout }: { admin: Admin; onLogout: () => void }) {
  const navigate = useNavigate();
  async function logout() {
    await api('/api/gathering-admin/auth/logout', { method: 'POST' });
    onLogout();
    navigate('/login');
  }
  return (
    <div className="shell">
      <nav aria-label="관리 메뉴">
        {LINKS.map(([href, label]) => (
          <NavLink key={href} to={href} end={href === '/'}>
            {label}
          </NavLink>
        ))}
        <button className="ghost" onClick={() => void logout()}>로그아웃</button>
      </nav>
      <main>
        <div className="top">
          <strong>{admin.loginId}</strong>
          <span>{admin.role === 'SUPER_ADMIN' ? '슈퍼관리자' : '담당관리자'}</span>
        </div>
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/groups" element={<GroupsPage />} />
          <Route path="/groups/:groupId" element={<GroupPage role={admin.role} />} />
          <Route path="/members" element={<MembersPage />} />
          <Route path="/audits" element={<AuditsPage />} />
          <Route path="/settings" element={<SettingsPage role={admin.role} />} />
          <Route path="/admins" element={<AdminsPage role={admin.role} adminId={admin.id} />} />
          <Route path="/account" element={<AccountPage onLogout={onLogout} />} />
        </Routes>
      </main>
    </div>
  );
}

function Login({ onDone }: { onDone: (admin: Admin) => void }) {
  const navigate = useNavigate();
  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    sessionStorage.removeItem('enrollmentToken');
  }, []);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    try {
      const result = await api<{ status: string; admin?: Admin; csrfToken?: string }>(
        '/api/gathering-admin/auth/login',
        { method: 'POST', body: JSON.stringify({ loginId, password }) },
      );
      if (result.admin) onDone(result.admin);
      navigate('/');
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : '로그인에 실패했습니다.');
    }
  }
  return (
    <form className="login panel" onSubmit={(event) => void submit(event)}>
      <h1>JCI KOREA 관리</h1>
      <label>아이디<input value={loginId} onChange={(event) => setLoginId(event.target.value)} autoComplete="username" /></label>
      <label>비밀번호<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" /></label>
      {error ? <p className="error">{error}</p> : null}
      <button type="submit">로그인</button>
    </form>
  );
}
