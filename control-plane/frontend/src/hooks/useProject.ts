import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { projectsApi } from '@/api/projects.api';

export function useProjects() {
  return useQuery({
    queryKey: ['projects'],
    queryFn: async () => {
      const data = await projectsApi.list();
      return data.projects;
    },
  });
}

export function useCurrentProject() {
  const { slug } = useParams<{ slug: string }>();

  return useQuery({
    queryKey: ['project', slug],
    queryFn: async () => {
      if (!slug) throw new Error('No project slug');
      const data = await projectsApi.getBySlug(slug);
      return data.project;
    },
    enabled: !!slug,
  });
}

export function useProjectMembers(projectId: string | undefined) {
  return useQuery({
    queryKey: ['project-members', projectId],
    queryFn: async () => {
      if (!projectId) throw new Error('No project ID');
      const data = await projectsApi.getMembers(projectId);
      return data.members;
    },
    enabled: !!projectId,
  });
}
