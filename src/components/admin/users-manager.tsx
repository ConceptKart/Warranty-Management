"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import type { AdminUserRow } from "@/lib/admin/users";

const ROLE_OPTIONS = [
  { value: "support", label: "Support Agent" },
  { value: "operations", label: "Operations" },
  { value: "packer", label: "Packer" },
  { value: "manager", label: "Manager" },
  { value: "admin", label: "Admin" },
] as const;

const roleColors: Record<string, string> = {
  admin: "danger",
  manager: "warning",
  support: "info",
  operations: "primary",
  packer: "secondary",
};

function formatLastLogin(value: Date | string | null) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatCreated(value: Date | string | null) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function UsersManager({
  users,
  currentUserId,
}: {
  users: AdminUserRow[];
  currentUserId: number;
}) {
  const router = useRouter();
  const [createOpen, setCreateOpen] = useState(false);
  const [editUser, setEditUser] = useState<AdminUserRow | null>(null);
  const [message, setMessage] = useState<{
    type: "success" | "danger";
    text: string;
  } | null>(null);
  const [loading, setLoading] = useState(false);

  async function api(body: Record<string, unknown>) {
    const res = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return (await res.json()) as { success?: boolean; error?: string };
  }

  async function onCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setLoading(true);
    try {
      const result = await api({
        action: "create",
        username: String(form.get("username") ?? ""),
        password: String(form.get("password") ?? ""),
        full_name: String(form.get("full_name") ?? ""),
        email: String(form.get("email") ?? ""),
        role: String(form.get("role") ?? "support"),
      });
      if (!result.success) {
        setMessage({
          type: "danger",
          text: result.error ?? "Error creating user.",
        });
        return;
      }
      setCreateOpen(false);
      setMessage({ type: "success", text: "User created successfully." });
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  async function onUpdate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!editUser) return;
    const form = new FormData(e.currentTarget);
    setLoading(true);
    try {
      const result = await api({
        action: "update",
        user_id: editUser.user_id,
        full_name: String(form.get("full_name") ?? ""),
        email: String(form.get("email") ?? ""),
        role: String(form.get("role") ?? "support"),
        is_active: form.get("is_active") === "1",
        new_password: String(form.get("new_password") ?? ""),
      });
      if (!result.success) {
        setMessage({
          type: "danger",
          text: result.error ?? "Error updating user.",
        });
        return;
      }
      setEditUser(null);
      setMessage({ type: "success", text: "User updated successfully." });
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  async function onDelete(user: AdminUserRow) {
    if (!confirm(`Delete user ${user.username}?`)) return;
    setLoading(true);
    try {
      const result = await api({
        action: "delete",
        user_id: user.user_id,
      });
      if (!result.success) {
        setMessage({
          type: "danger",
          text: result.error ?? "Error deleting user.",
        });
        return;
      }
      setMessage({ type: "success", text: "User deleted." });
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <div className="admin-page-header">
        <h4 className="mb-0">
          <i className="fas fa-users me-2" />
          User Management
        </h4>
        <div className="admin-page-actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setCreateOpen(true)}
          >
            <i className="fas fa-plus me-1" />
            New User
          </button>
        </div>
      </div>

      {message ? (
        <div
          className={`alert alert-${message.type} alert-dismissible fade show`}
          role="alert"
        >
          {message.text}
          <button
            type="button"
            className="btn-close"
            aria-label="Close"
            onClick={() => setMessage(null)}
          />
        </div>
      ) : null}

      <div className="card shadow">
        <div className="card-body p-0">
          <div className="table-responsive">
            <table className="table table-hover mb-0">
              <thead className="table-dark">
                <tr>
                  <th>#</th>
                  <th>Username</th>
                  <th>Full Name</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Last Login</th>
                  <th>Created</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="text-center py-4 text-muted">
                      No users found.
                    </td>
                  </tr>
                ) : (
                  users.map((u) => (
                    <tr key={u.user_id}>
                      <td>{u.user_id}</td>
                      <td>
                        <strong>{u.username}</strong>
                      </td>
                      <td>{u.full_name}</td>
                      <td>
                        <small>{u.email}</small>
                      </td>
                      <td>
                        <span
                          className={`badge bg-${roleColors[u.role] ?? "secondary"}`}
                        >
                          {u.role.charAt(0).toUpperCase() + u.role.slice(1)}
                        </span>
                      </td>
                      <td>
                        {u.is_active ? (
                          <span className="badge bg-success">Active</span>
                        ) : (
                          <span className="badge bg-secondary">Inactive</span>
                        )}
                      </td>
                      <td>
                        <small>
                          {formatLastLogin(u.last_login) ?? (
                            <span className="text-muted">Never</span>
                          )}
                        </small>
                      </td>
                      <td>
                        <small>{formatCreated(u.created_at)}</small>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn btn-sm btn-outline-primary me-1"
                          title="Edit"
                          onClick={() => setEditUser(u)}
                        >
                          <i className="fas fa-edit" />
                        </button>
                        {u.user_id !== currentUserId ? (
                          <button
                            type="button"
                            className="btn btn-sm btn-outline-danger"
                            title="Delete"
                            disabled={loading}
                            onClick={() => onDelete(u)}
                          >
                            <i className="fas fa-trash" />
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {createOpen ? (
        <Modal
          title={
            <>
              <i className="fas fa-user-plus me-2" />
              Create New User
            </>
          }
          headerClass="bg-primary text-white"
          closeWhite
          onClose={() => setCreateOpen(false)}
        >
          <form onSubmit={onCreate}>
            <div className="mb-3">
              <label className="form-label fw-semibold">
                Username <span className="text-danger">*</span>
              </label>
              <input
                type="text"
                name="username"
                className="form-control"
                required
                pattern="[a-zA-Z0-9_]+"
                placeholder="lowercase, letters/numbers/underscore"
              />
            </div>
            <div className="mb-3">
              <label className="form-label fw-semibold">
                Password <span className="text-danger">*</span>
              </label>
              <input
                type="password"
                name="password"
                className="form-control"
                required
                minLength={6}
              />
              <div className="form-text">Minimum 6 characters.</div>
            </div>
            <div className="mb-3">
              <label className="form-label fw-semibold">
                Full Name <span className="text-danger">*</span>
              </label>
              <input
                type="text"
                name="full_name"
                className="form-control"
                required
              />
            </div>
            <div className="mb-3">
              <label className="form-label fw-semibold">Email</label>
              <input type="email" name="email" className="form-control" />
            </div>
            <div className="mb-3">
              <label className="form-label fw-semibold">
                Role <span className="text-danger">*</span>
              </label>
              <select name="role" className="form-select" required defaultValue="support">
                {ROLE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <div className="form-text">
                <strong>Admin:</strong> full access + user management.
                <br />
                <strong>Manager:</strong> all tickets + reports, no user
                management.
                <br />
                <strong>Support:</strong> view &amp; edit tickets only.
                <br />
                <strong>Operations:</strong> manage shipments &amp; AWB
                assignments.
                <br />
                <strong>Packer:</strong> pack &amp; dispatch operations.
              </div>
            </div>
            <div className="d-flex justify-content-end gap-2">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setCreateOpen(false)}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={loading}
              >
                <i className="fas fa-save me-1" />
                {loading ? "Saving…" : "Create User"}
              </button>
            </div>
          </form>
        </Modal>
      ) : null}

      {editUser ? (
        <Modal
          title={
            <>
              <i className="fas fa-user-edit me-2" />
              Edit User
            </>
          }
          headerClass="bg-warning"
          onClose={() => setEditUser(null)}
        >
          <form onSubmit={onUpdate}>
            <div className="mb-3">
              <label className="form-label fw-semibold">Username</label>
              <input
                type="text"
                className="form-control bg-light"
                value={editUser.username}
                readOnly
              />
              <div className="form-text">Username cannot be changed.</div>
            </div>
            <div className="mb-3">
              <label className="form-label fw-semibold">New Password</label>
              <input
                type="password"
                name="new_password"
                className="form-control"
                minLength={6}
                placeholder="Leave blank to keep current password"
              />
            </div>
            <div className="mb-3">
              <label className="form-label fw-semibold">
                Full Name <span className="text-danger">*</span>
              </label>
              <input
                type="text"
                name="full_name"
                className="form-control"
                required
                defaultValue={editUser.full_name}
              />
            </div>
            <div className="mb-3">
              <label className="form-label fw-semibold">Email</label>
              <input
                type="email"
                name="email"
                className="form-control"
                defaultValue={editUser.email}
              />
            </div>
            <div className="mb-3">
              <label className="form-label fw-semibold">Role</label>
              <select
                name="role"
                className="form-select"
                defaultValue={editUser.role}
              >
                {ROLE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-check form-switch mb-3">
              <input
                className="form-check-input"
                type="checkbox"
                name="is_active"
                id="edit_is_active"
                value="1"
                defaultChecked={editUser.is_active}
              />
              <label className="form-check-label" htmlFor="edit_is_active">
                Account Active
              </label>
            </div>
            <div className="d-flex justify-content-end gap-2">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setEditUser(null)}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn btn-warning"
                disabled={loading}
              >
                <i className="fas fa-save me-1" />
                {loading ? "Saving…" : "Save Changes"}
              </button>
            </div>
          </form>
        </Modal>
      ) : null}
    </>
  );
}

function Modal({
  title,
  headerClass,
  closeWhite,
  onClose,
  children,
}: {
  title: React.ReactNode;
  headerClass: string;
  closeWhite?: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="modal fade show d-block"
      tabIndex={-1}
      role="dialog"
      style={{ backgroundColor: "rgba(0,0,0,.5)" }}
      onClick={onClose}
    >
      <div
        className="modal-dialog modal-dialog-centered modal-dialog-scrollable"
        role="document"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-content">
          <div className={`modal-header ${headerClass}`}>
            <h5 className="modal-title">{title}</h5>
            <button
              type="button"
              className={`btn-close${closeWhite ? " btn-close-white" : ""}`}
              aria-label="Close"
              onClick={onClose}
            />
          </div>
          <div className="modal-body">{children}</div>
        </div>
      </div>
    </div>
  );
}
