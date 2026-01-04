import type { OutputSchema, SchemaField, SchemaFieldType } from '../types/database';

interface JsonSchema {
  type: string;
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  required?: string[];
  additionalProperties?: boolean;
  description?: string;
  enum?: string[];
}

/**
 * Convert internal schema format to JSON Schema
 */
export function toJsonSchema(schema: OutputSchema): JsonSchema {
  const properties: Record<string, JsonSchema> = {};
  const required: string[] = [];

  for (const field of schema.fields) {
    properties[field.name] = fieldToJsonSchema(field);
    if (field.required) {
      required.push(field.name);
    }
  }

  return {
    type: 'object',
    properties,
    required,
    additionalProperties: false,
  };
}

function fieldToJsonSchema(field: SchemaField): JsonSchema {
  const base: JsonSchema = {
    type: field.type,
  };

  if (field.description) {
    base.description = field.description;
  }

  if (field.enum && field.enum.length > 0) {
    base.enum = field.enum;
  }

  if (field.type === 'array' && field.items) {
    base.items = fieldToJsonSchema(field.items);
  }

  if (field.type === 'object' && field.properties) {
    const props: Record<string, JsonSchema> = {};
    const req: string[] = [];
    for (const prop of field.properties) {
      props[prop.name] = fieldToJsonSchema(prop);
      if (prop.required) {
        req.push(prop.name);
      }
    }
    base.properties = props;
    base.required = req;
    base.additionalProperties = false;
  }

  return base;
}

/**
 * Convert JSON Schema to internal schema format
 */
export function fromJsonSchema(jsonSchema: JsonSchema, name = 'response'): OutputSchema {
  const fields: SchemaField[] = [];

  if (jsonSchema.properties) {
    const required = jsonSchema.required || [];
    for (const [fieldName, def] of Object.entries(jsonSchema.properties)) {
      fields.push(parseField(fieldName, def, required));
    }
  }

  return {
    enabled: true,
    name,
    strict: true,
    fields,
  };
}

function parseField(name: string, def: JsonSchema, required: string[]): SchemaField {
  const field: SchemaField = {
    name,
    type: (def.type as SchemaFieldType) || 'string',
    required: required.includes(name),
    description: def.description,
  };

  if (def.enum) {
    field.enum = def.enum;
  }

  if (def.type === 'array' && def.items) {
    field.items = parseField('item', def.items, []);
  }

  if (def.type === 'object' && def.properties) {
    const nestedRequired = def.required || [];
    field.properties = [];
    for (const [propName, propDef] of Object.entries(def.properties)) {
      field.properties.push(parseField(propName, propDef, nestedRequired));
    }
  }

  return field;
}

/**
 * Generate OpenAI-compatible response_format
 */
export function toResponseFormat(schema: OutputSchema): object {
  return {
    type: 'json_schema',
    json_schema: {
      name: schema.name || 'response',
      strict: schema.strict,
      schema: toJsonSchema(schema),
    },
  };
}

/**
 * Convert JSON Schema string to internal format
 */
export function parseJsonSchemaString(jsonString: string): OutputSchema | null {
  try {
    const parsed = JSON.parse(jsonString);
    return fromJsonSchema(parsed);
  } catch {
    return null;
  }
}

/**
 * Stringify internal schema to JSON Schema string
 */
export function stringifySchema(schema: OutputSchema): string {
  return JSON.stringify(toJsonSchema(schema), null, 2);
}

/**
 * Create a default empty schema
 */
export function createEmptySchema(): OutputSchema {
  return {
    enabled: false,
    name: 'response',
    strict: true,
    fields: [],
  };
}

/**
 * Create a default field
 */
export function createDefaultField(index: number): SchemaField {
  return {
    name: `field_${index}`,
    type: 'string',
    required: true,
    description: '',
  };
}

/**
 * Infer schema from a JSON example
 * This analyzes the structure of the JSON and creates a matching schema
 */
export function inferSchemaFromJson(jsonString: string): OutputSchema | null {
  try {
    const parsed = JSON.parse(jsonString);

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      // Root must be an object
      return null;
    }

    const fields = inferFieldsFromObject(parsed);

    return {
      enabled: true,
      name: 'response',
      strict: true,
      fields,
    };
  } catch {
    return null;
  }
}

function inferFieldsFromObject(obj: Record<string, unknown>): SchemaField[] {
  const fields: SchemaField[] = [];

  for (const [key, value] of Object.entries(obj)) {
    fields.push(inferField(key, value));
  }

  return fields;
}

function inferField(name: string, value: unknown): SchemaField {
  const field: SchemaField = {
    name,
    type: 'string',
    required: true,
  };

  if (value === null || value === undefined) {
    field.type = 'string';
    field.required = false;
  } else if (typeof value === 'string') {
    field.type = 'string';
  } else if (typeof value === 'number') {
    field.type = 'number';
  } else if (typeof value === 'boolean') {
    field.type = 'boolean';
  } else if (Array.isArray(value)) {
    field.type = 'array';
    if (value.length > 0) {
      // Infer items type from first element
      field.items = inferField('item', value[0]);
    } else {
      // Default to string array if empty
      field.items = {
        name: 'item',
        type: 'string',
        required: true,
      };
    }
  } else if (typeof value === 'object') {
    field.type = 'object';
    field.properties = inferFieldsFromObject(value as Record<string, unknown>);
  }

  return field;
}
