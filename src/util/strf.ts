export function strf(str: string, ...args: string[]): string {
  args.forEach((arg, i) => (str = str.replace(`%${i + 1}`, arg)));
  return str;
}
