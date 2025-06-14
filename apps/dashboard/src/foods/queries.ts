export interface Food {
  id: number;
  name: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

export const getFoods = async (): Promise<Food[]> => {
  const foodsResponse = await fetch("http://localhost:8080/foods");
  const foods = (await foodsResponse.json()) as { data: Food[] };

  return foods.data;
};
