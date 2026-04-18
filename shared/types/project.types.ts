import { z } from 'zod';

export const createProjectSchema = z.object({
  name: z.string().min(1, 'Name is required').max(255),
  slug: z.string().min(4, 'Slug must be at least 4 characters').max(255).regex(/^[a-z0-9-]+$/, 'Slug must be lowercase alphanumeric with dashes'),
  description: z.string().max(1000).optional(),
  node_id: z.string().uuid('Node is required'),
});

export const updateProjectSchema = createProjectSchema.partial();

export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;

export type ProjectRole = 'admin' | 'editor' | 'viewer';

export interface Project {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  db_schema: string;
  node_id: string | null;
  node_url?: string;
  settings: Record<string, unknown>;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface ProjectMember {
  id: string;
  project_id: string;
  user_id: string;
  role: ProjectRole;
  created_at: string;
}

export interface InviteKey {
  id: string;
  key: string;
  created_by: string;
  role: ProjectRole;
  max_uses: number;
  current_uses: number;
  expires_at: string | null;
  project_id: string;
  is_active: boolean;
  created_at: string;
}
