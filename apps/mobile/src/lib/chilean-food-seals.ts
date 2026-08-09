export const CHILEAN_FOOD_SEALS = [
  'ALTO EN CALORÍAS',
  'ALTO EN SODIO',
  'ALTO EN AZÚCARES',
  'ALTO EN GRASAS SATURADAS',
] as const;

export const foodSealLabel = (seal: string) => {
  const normalized = seal.trim().toLocaleLowerCase('es-CL');
  return normalized ? normalized.charAt(0).toLocaleUpperCase('es-CL') + normalized.slice(1) : seal;
};
