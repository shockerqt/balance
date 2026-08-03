export const USER_PREFERENCES_SCHEMA = {
  title: 'userPreferences schema',
  version: 0,
  primaryKey: 'id',
  type: 'object',
  properties: {
    id: {
      type: 'string',
      maxLength: 64,
    },
    preferences: {
      type: 'object', // Lax Schema
    },
    updatedAt: {
      type: 'number',
    },
  },
  required: ['id', 'updatedAt'],
};

export const MEAL_TEMPLATES_SCHEMA = {
  title: 'mealTemplates schema',
  version: 0,
  primaryKey: 'id',
  type: 'object',
  properties: {
    id: {
      type: 'string',
      maxLength: 64,
    },
    name: {
      type: 'string',
    },
    details: {
      type: 'object', // Lax Schema
    },
    updatedAt: {
      type: 'number',
    },
  },
  required: ['id', 'name', 'updatedAt'],
};

export const MEAL_LOGS_SCHEMA = {
  title: 'mealLogs schema',
  version: 0,
  primaryKey: 'id',
  type: 'object',
  properties: {
    id: {
      type: 'string',
      maxLength: 64,
    },
    templateId: {
      type: 'string',
    },
    nameSnapshot: {
      type: 'string',
    },
    nutritionSnapshot: {
      type: 'object', // Lax Schema
    },
    quantity: {
      type: 'number',
    },
    consumedAt: {
      type: 'number',
    },
    updatedAt: {
      type: 'number',
    },
  },
  required: ['id', 'nameSnapshot', 'consumedAt', 'updatedAt'],
};
