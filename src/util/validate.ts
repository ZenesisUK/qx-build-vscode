export type Pojo = Record<string, unknown>;

export const isPojo = (value: unknown): value is Pojo =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const keyIsString = <T extends keyof any>(key: T, data: Pojo): data is Pojo & { [key in T]: string } =>
  key in data && typeof data[key as keyof typeof data] === "string";

export const isStringArray = (data: unknown): data is string[] =>
  Array.isArray(data) && data.every((item: unknown) => typeof item === "string");

export const keyIsArrayOfString = <T extends keyof any>(key: T, data: Pojo): data is Pojo & { [key in T]: string[] } =>
  key in data && isStringArray(data[key as keyof typeof data]);

export const removeDuplicates = <T>(array: T[]): T[] => [...new Set(array)];
