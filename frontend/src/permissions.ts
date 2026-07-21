export type Role = 'admin' | 'editor' | 'viewer'

export const ROLES: { value: Role; label: string; description: string }[] = [
  {
    value: 'admin',
    label: 'Administrator',
    description: 'Users, inbox, audit, finalize reviews, all cases, and export',
  },
  {
    value: 'editor',
    label: 'Editor',
    description: 'Create and edit cases, generate IR drafts, and export/download reports',
  },
  {
    value: 'viewer',
    label: 'Viewer',
    description: 'Create and edit cases and IR drafts in-system; cannot export or copy the product',
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
  return r === 'admin' || r === 'editor' || r === 'viewer'
}

export function canExport(role?: string | null, isAdmin?: boolean): boolean {
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
