import { API_BASE_URL } from '@/services/config';
import { MealTemplateDoc, isMealTemplateDoc } from './types';

export type OfficialTemplate = MealTemplateDoc;

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
    return Array.isArray(data.templates) ? data.templates.filter(isMealTemplateDoc) : [];
  } catch (e) {
    console.warn('[Official Templates] Error fetching official templates in guest mode', e);
    return [];
  }
}
