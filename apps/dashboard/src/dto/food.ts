export enum ServingUnitType {
  Weight = "Weight",
  Volume = "Volume",
}

export type GetFoodsResponse = {
  foods: FoodDto[];
};

export type FoodDto = {
  id: number;
  name: string;
  calories: number;
  fat: number;
  proteins: number;
  carbs: number;
  saturatedFat: number | null;
  monounsaturatedFat: number | null;
  polyunsaturatedFat: number | null;
  transFat: number | null;
  fiber: number | null;
  sugars: number | null;
  sodium: number | null;
  cholesterol: number | null;
  servingName: string;
  servingQuantity: number;
  servingUnitType: ServingUnitType;
  createdBy: number;
  isVerified: boolean;
  createdAt: string;
  updatedAt: string;
};

export type UpdateFoodDto = {
  id: number;
  name: string;
  calories: number;
  fat: number;
  proteins: number;
  carbs: number;
  saturatedFat: number | null;
  monounsaturatedFat: number | null;
  polyunsaturatedFat: number | null;
  transFat: number | null;
  fiber: number | null;
  sugars: number | null;
  sodium: number | null;
  cholesterol: number | null;
  servingName: string;
  servingQuantity: number;
  servingUnitType: ServingUnitType;
};
