/**
 * P0 认证 API 封装。
 *
 * 所有 fetch 带 credentials: "include" 确保 cookie 随请求发送。
 * SSO 接入后只替换 login() 内部实现。
 */

export interface AuthUser {
  user_id: string;
  display_name: string;
  is_admin: boolean;
}

/** 后端地址。留空 = 同域请求（走 nginx 代理 /api/ → 后端），cookie 自动随请求。 */
function baseUrl(): string {
  return "";
}

export async function login(
  username: string,
  password: string
): Promise<AuthUser> {
  const res = await fetch(`${baseUrl()}/api/auth/login`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `登录失败 (${res.status})`);
  }
  return res.json();
}

export async function logout(): Promise<void> {
  await fetch(`${baseUrl()}/api/auth/logout`, {
    method: "POST",
    credentials: "include",
  });
}

/** 获取当前登录用户。未登录返回 null。 */
export async function getMe(): Promise<AuthUser | null> {
  try {
    const res = await fetch(`${baseUrl()}/api/auth/me`, {
      credentials: "include",
    });
    if (res.status === 401) return null;
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

// ── 用户管理 API（仅 admin 可用）───────────────────────

export interface UserRecord {
  user_id: string;
  display_name: string;
  is_admin: boolean;
}

/** 列出所有用户（从 auth_users.json）。 */
export async function listUsers(): Promise<UserRecord[]> {
  const res = await fetch(`${baseUrl()}/api/auth/users/auth-list`, {
    credentials: "include",
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `获取用户列表失败 (${res.status})`);
  }
  const data = await res.json();
  return data.users || [];
}

/** 新增用户。 */
export async function addUser(params: {
  user_id: string;
  password: string;
  display_name?: string;
  is_admin?: boolean;
}): Promise<UserRecord> {
  const res = await fetch(`${baseUrl()}/api/auth/users`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `新增用户失败 (${res.status})`);
  }
  const data = await res.json();
  return data.user;
}

/** 修改用户（密码/显示名/管理员）。 */
export async function updateUser(
  userId: string,
  params: { password?: string; display_name?: string; is_admin?: boolean }
): Promise<UserRecord> {
  const res = await fetch(`${baseUrl()}/api/auth/users/${encodeURIComponent(userId)}`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `修改用户失败 (${res.status})`);
  }
  const data = await res.json();
  return data.user;
}

/** 删除用户。 */
export async function deleteUser(userId: string): Promise<void> {
  const res = await fetch(`${baseUrl()}/api/auth/users/${encodeURIComponent(userId)}`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `删除用户失败 (${res.status})`);
  }
}
