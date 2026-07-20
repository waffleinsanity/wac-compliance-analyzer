export type Role = 'admin' | 'editor' | 'viewer'

export const ROLES: { value: Role; label: string; description: string }[] = [
  {
    value: 'admin',
    label: 'Administrator',
    description: 'Users, inbox, audit, finalize reviews, and all editor tools',
  },
  {
    value: 'editor',
    label: 'Editor',
    description: 'Create and edit cases, generate drafts, submit for review',
  },
  {
    value: 'viewer',
    label: 'Viewer',
    description: 'Read-only access to cases and the WAC directory',
  },
]

export function normalizeRole(role?: string | null, isAdmin?: boolean): Role {
  const value = (role || '').trim().toLowerCase()
  if (value === 'admin' || value === 'editor' || value === 'viewer') return value
  if (isAdmin) return 'admin'
  return 'editor'
}

export function canEdit(role?: string | null, isAdmin?: boolean): boolean {
  const r = normalizeRole(role, isAdmin)
  return r === 'admin' || r === 'editor'
}

export function canReview(role?: string | null, isAdmin?: boolean): boolean {
  return normalizeRole(role, isAdmin) === 'admin'
}

export function canAccessAdmin(role?: string | null, isAdmin?: boolean): boolean {
  return normalizeRole(role, isAdmin) === 'admin'
}

export function roleLabel(role?: string | null, isAdmin?: boolean): string {
  const r = normalizeRole(role, isAdmin)
  return ROLES.find((x) => x.value === r)?.label || r
}
