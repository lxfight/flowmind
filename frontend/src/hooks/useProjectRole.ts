import { useAuthStore } from '../stores/authStore'
import { useProjectStore } from '../stores/projectStore'

export function useProjectRole() {
  const user = useAuthStore((s) => s.user)
  const currentProject = useProjectStore((s) => s.currentProject)
  if (user?.is_superuser) return 'owner'
  return currentProject?.current_user_role || 'viewer'
}
