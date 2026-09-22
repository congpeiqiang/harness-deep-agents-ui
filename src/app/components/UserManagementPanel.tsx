"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  listUsers,
  addUser,
  updateUser,
  deleteUser,
  type UserRecord,
} from "@/lib/authApi";
import { Plus, Pencil, Trash2 } from "lucide-react";

interface UserManagementPanelProps {
  active: boolean;
}

/**
 * 用户管理面板（仅 admin 可见）。
 * 列出 auth_users.json 中的用户，支持增删改。
 */
export function UserManagementPanel({ active }: UserManagementPanelProps) {
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [currentUser, setCurrentUser] = useState<UserRecord | null>(null);

  // 弹窗状态
  const [addOpen, setAddOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [targetUser, setTargetUser] = useState<UserRecord | null>(null);

  // 表单状态
  const [formUserId, setFormUserId] = useState("");
  const [formPassword, setFormPassword] = useState("");
  const [formDisplayName, setFormDisplayName] = useState("");
  const [formIsAdmin, setFormIsAdmin] = useState(false);
  const [saving, setSaving] = useState(false);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const list = await listUsers();
      setUsers(list);
      // 识别当前用户（第一个 is_admin=true 的，或通过 getMe 获取）
      const me = list.find((u) => u.is_admin) || list[0] || null;
      setCurrentUser(me);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "未知错误";
      toast.error(`加载用户列表失败: ${msg}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (active) fetchUsers();
  }, [active, fetchUsers]);

  // ── 新增用户 ──
  const resetAddForm = () => {
    setFormUserId("");
    setFormPassword("");
    setFormDisplayName("");
    setFormIsAdmin(false);
  };

  const handleAdd = async () => {
    if (!formUserId.trim()) {
      toast.error("用户名不能为空");
      return;
    }
    if (!formPassword || formPassword.length < 4) {
      toast.error("密码至少 4 位");
      return;
    }
    setSaving(true);
    try {
      await addUser({
        user_id: formUserId.trim(),
        password: formPassword,
        display_name: formDisplayName.trim() || undefined,
        is_admin: formIsAdmin,
      });
      toast.success(`用户 ${formUserId} 已创建`);
      setAddOpen(false);
      resetAddForm();
      fetchUsers();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "未知错误";
      toast.error(`新增失败: ${msg}`);
    } finally {
      setSaving(false);
    }
  };

  // ── 编辑用户 ──
  const openEdit = (user: UserRecord) => {
    setTargetUser(user);
    setFormPassword("");
    setFormDisplayName(user.display_name);
    setFormIsAdmin(user.is_admin);
    setEditOpen(true);
  };

  const handleEdit = async () => {
    if (!targetUser) return;
    setSaving(true);
    try {
      const params: { password?: string; display_name?: string; is_admin?: boolean } = {};
      if (formPassword) {
        if (formPassword.length < 4) {
          toast.error("密码至少 4 位");
          setSaving(false);
          return;
        }
        params.password = formPassword;
      }
      if (formDisplayName !== targetUser.display_name) {
        params.display_name = formDisplayName;
      }
      if (formIsAdmin !== targetUser.is_admin) {
        params.is_admin = formIsAdmin;
      }
      if (Object.keys(params).length === 0) {
        toast.info("没有修改");
        setSaving(false);
        return;
      }
      await updateUser(targetUser.user_id, params);
      toast.success(`用户 ${targetUser.user_id} 已更新`);
      setEditOpen(false);
      setTargetUser(null);
      fetchUsers();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "未知错误";
      toast.error(`修改失败: ${msg}`);
    } finally {
      setSaving(false);
    }
  };

  // ── 删除用户 ──
  const openDelete = (user: UserRecord) => {
    setTargetUser(user);
    setDeleteOpen(true);
  };

  const handleDelete = async () => {
    if (!targetUser) return;
    setSaving(true);
    try {
      await deleteUser(targetUser.user_id);
      toast.success(`用户 ${targetUser.user_id} 已删除`);
      setDeleteOpen(false);
      setTargetUser(null);
      fetchUsers();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "未知错误";
      toast.error(`删除失败: ${msg}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          管理系统登录用户。修改后立即生效，无需重启。
        </p>
        <Button
          size="sm"
          onClick={() => {
            resetAddForm();
            setAddOpen(true);
          }}
        >
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          新增用户
        </Button>
      </div>

      {/* 用户列表表格 */}
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted/50">
            <tr>
              <th className="px-3 py-2 text-left font-medium">用户名</th>
              <th className="px-3 py-2 text-left font-medium">显示名</th>
              <th className="px-3 py-2 text-left font-medium">管理员</th>
              <th className="px-3 py-2 text-right font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">
                  加载中…
                </td>
              </tr>
            ) : users.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">
                  暂无用户
                </td>
              </tr>
            ) : (
              users.map((user) => (
                <tr key={user.user_id} className="border-b border-border last:border-0">
                  <td className="px-3 py-2 font-mono text-xs">{user.user_id}</td>
                  <td className="px-3 py-2">{user.display_name}</td>
                  <td className="px-3 py-2">
                    {user.is_admin ? (
                      <span className="inline-flex rounded bg-blue-100 px-1.5 py-0.5 text-xs font-medium text-blue-800">
                        是
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">否</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openEdit(user)}
                        title="编辑"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openDelete(user)}
                        title="删除"
                        disabled={
                          currentUser?.user_id === user.user_id || users.length <= 1
                        }
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* ── 新增弹窗 ── */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>新增用户</DialogTitle>
            <DialogDescription>创建一个新的登录账号。</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="grid gap-1.5">
              <Label htmlFor="add-user-id">用户名</Label>
              <Input
                id="add-user-id"
                value={formUserId}
                onChange={(e) => setFormUserId(e.target.value)}
                placeholder="例如 zhangsan"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="add-password">密码</Label>
              <Input
                id="add-password"
                type="password"
                value={formPassword}
                onChange={(e) => setFormPassword(e.target.value)}
                placeholder="至少 4 位"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="add-display-name">显示名（可选）</Label>
              <Input
                id="add-display-name"
                value={formDisplayName}
                onChange={(e) => setFormDisplayName(e.target.value)}
                placeholder="留空则显示用户名"
              />
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="add-is-admin">管理员权限</Label>
              <Switch checked={formIsAdmin} onCheckedChange={setFormIsAdmin} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)} disabled={saving}>
              取消
            </Button>
            <Button onClick={handleAdd} disabled={saving}>
              {saving ? "创建中…" : "创建"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── 编辑弹窗 ── */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>编辑用户：{targetUser?.user_id}</DialogTitle>
            <DialogDescription>留空密码表示不修改密码。</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="grid gap-1.5">
              <Label htmlFor="edit-password">新密码</Label>
              <Input
                id="edit-password"
                type="password"
                value={formPassword}
                onChange={(e) => setFormPassword(e.target.value)}
                placeholder="留空 = 不修改"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="edit-display-name">显示名</Label>
              <Input
                id="edit-display-name"
                value={formDisplayName}
                onChange={(e) => setFormDisplayName(e.target.value)}
              />
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="edit-is-admin">管理员权限</Label>
              <Switch checked={formIsAdmin} onCheckedChange={setFormIsAdmin} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)} disabled={saving}>
              取消
            </Button>
            <Button onClick={handleEdit} disabled={saving}>
              {saving ? "保存中…" : "保存"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── 删除确认弹窗 ── */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>确认删除</DialogTitle>
            <DialogDescription>
              确定要删除用户 <span className="font-medium text-foreground">{targetUser?.user_id}</span> 吗？此操作不可撤销。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)} disabled={saving}>
              取消
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={saving}>
              {saving ? "删除中…" : "删除"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
