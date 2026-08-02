// API Client for Balance Rust Axum Server (http://144.22.47.0:8080 or local)

const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL || 'http://144.22.47.0:8080';

export interface CreateMealPayload {
  eaten_at: string; // ISO 8601 string
  meal_type?: string;
}

export interface AddFoodToMealPayload {
  food_version_id: number;
  serving_quantity: number;
  serving_name?: string;
}

export const ApiClient = {
  // Fetch list of meals from Rust backend
  async getMeals() {
    try {
      const response = await fetch(`${API_BASE_URL}/meals`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!response.ok) return null;
      return await response.json();
    } catch (e) {
      console.warn('API Offline or unreachable, falling back to local storage', e);
      return null;
    }
  },

  // Create a new meal on Rust backend
  async createMeal(payload: CreateMealPayload) {
    try {
      const response = await fetch(`${API_BASE_URL}/meals/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!response.ok) return null;
      return await response.json();
    } catch (e) {
      console.warn('Failed to sync created meal to API', e);
      return null;
    }
  },

  // Add a food item to a meal on Rust backend
  async addFoodToMeal(mealId: number, payload: AddFoodToMealPayload) {
    try {
      const response = await fetch(`${API_BASE_URL}/meals/${mealId}/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!response.ok) return null;
      return await response.json();
    } catch (e) {
      console.warn('Failed to sync added food to API', e);
      return null;
    }
  },

  // Get daily summary from Rust backend
  async getDailySummary(dateStr: string) {
    try {
      const response = await fetch(`${API_BASE_URL}/meals/daily-summary?date=${dateStr}`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!response.ok) return null;
      return await response.json();
    } catch (e) {
      console.warn('Failed to fetch daily summary from API', e);
      return null;
    }
  },
};
