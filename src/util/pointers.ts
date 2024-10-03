import { BuildProcessData } from "../BuildProcess";
import path from "node:path";
import fs from "node:fs";
import { isStringArray } from "./validate";

type JsonPointer = `${string}#${string}`;
type BuildPointer = `${string}@${string}`;

const isValidJsonPointer = (pointer: unknown): pointer is JsonPointer =>
  typeof pointer === "string" && pointer.split("#").length === 2;

const isValidBuildPointer = (pointer: unknown, workDir: string): pointer is BuildPointer =>
  typeof pointer === "string" &&
  pointer.split("@").length === 2 &&
  fs.readdirSync(path.resolve(workDir, pointer.split("@")[0])).includes("qx.build");

function parseJsonPointer(workDir: string, pointer: JsonPointer) {
  if (!isValidJsonPointer(pointer)) throw new Error(`Invalid JSON pointer: ${pointer}`);
  const [relPath, dotPath] = pointer.split("#");
  const filePath = path.resolve(workDir, relPath);
  const fileContent = fs.readFileSync(filePath, "utf8");
  let result = JSON.parse(fileContent);
  const pathParts = dotPath.split(".");
  while (pathParts.length > 0) result = result[pathParts.shift()!];
  return result;
}

function parseBuildPointer(workDir: string, pointer: BuildPointer): BuildProcessData {
  if (!isValidBuildPointer(pointer, workDir)) throw new Error(`Invalid build pointer: '${pointer}'`);
  const [relPath, name] = pointer.split("@");
  const filePath = path.resolve(workDir, relPath, "qx.build");
  const fileContent = fs.readFileSync(filePath, "utf8");
  const fileJson = JSON.parse(fileContent);
  const result = fileJson["builders"].find((builder: { name: string }) => builder.name === name);
  if (!result) throw new Error(`Builder not found: '${name}'`);
  return result as BuildProcessData;
}

type BuildProcessDataKey = {
  [K in keyof BuildProcessData]: BuildProcessData[K] extends string[] ? K : never;
}[keyof BuildProcessData];

export function handlePointers(data: string[], workDir: string, buildDataKey: BuildProcessDataKey) {
  while (data.find(i => isValidJsonPointer(i) || isValidBuildPointer(i, workDir))) {
    for (const entry of data) {
      if (isValidJsonPointer(entry)) {
        data.splice(data.indexOf(entry), 1);
        const result = parseJsonPointer(workDir, entry);
        const isString = typeof result === "string";
        if (!isString && !isStringArray(result)) throw new Error(`${entry}: Expected string or string array`);
        if (isString) data.push(result);
        else data.push(...result);
      }
      if (isValidBuildPointer(entry, workDir)) {
        data.splice(data.indexOf(entry), 1);
        const result = parseBuildPointer(workDir, entry)[buildDataKey];
        if (!isStringArray(result)) throw new Error(`${entry}: Expected string array`);
        data.push(...result);
      }
    }
  }
  return data;
}
