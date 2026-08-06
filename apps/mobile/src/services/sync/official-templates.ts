import { API_BASE_URL } from '@/services/config';

export interface OfficialTemplate {
  id: string;
  name: string;
  details: Record<string, any>;
  isOfficial: boolean;
  updatedAt: number;
}

export async function fetchOfficialTemplates(): Promise<OfficialTemplate[]> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/templates/official`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      console.warn('[Official Templates] Failed to fetch official templates', response.status);
      return [];
    }

    const data = await response.json();
    return data.templates || [];
  } catch (e) {
    console.warn('[Official Templates] Error fetching official templates in guest mode', e);
    return [];
  }
}
